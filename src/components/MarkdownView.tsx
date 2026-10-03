import { useEffect, useMemo, useRef } from "react";
import { Alert, Box, SegmentGroup } from "@chakra-ui/react";
import { Code2, Eye } from "lucide-react";
import { openUrl, openPath } from "@tauri-apps/plugin-opener";
import { dirnameOf, renderFull, resolveLocalPath } from "../renderer/pipeline";
import hljs from "../renderer/hljs";
import { extractToc, isObserverPaused, useToc } from "../stores/toc";
import { pathExists } from "../tauri/api";
import { useTabs, type Tab } from "../stores/tabs";
import { useSettings, type ViewMode } from "../stores/settings";
import { withViewTransition } from "../utils/viewTransition";
import { EmptyState } from "./EmptyState";
import { FloatingScrollbar } from "./FloatingScrollbar";

const MD_EXTENSIONS = /\.(md|markdown|mdown|mkd)$/i;

/** True for hrefs that are real URLs (browser/mail/etc.), not filesystem paths. */
function isUrlHref(href: string): boolean {
  return (/^(?!file:)[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//"));
}

/** 代码视图目录用的源码标题(ATX 形式,跳过围栏代码块内的假标题)。 */
interface SourceHeading {
  line: number;
  text: string;
  level: number;
}

function extractHeadingsFromSource(content: string): SourceHeading[] {
  const out: SourceHeading[] = [];
  let fence: string | null = null;
  content.split("\n").forEach((raw, line) => {
    const fenceMatch = raw.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const m = raw.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) {
      out.push({ line, text: m[2].replace(/\s+#+\s*$/, "").trim(), level: m[1].length });
    }
  });
  return out;
}

/** hljs 输出的高亮 HTML 按行切分:遇到换行先补全闭合标签,下一行重新打开,
 *  保证每一行都是自包含的合法 HTML(便于按行包裹 span 注入锚点)。 */
function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const openTags: string[] = [];
  let cur = "";
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
      const close = html.indexOf(">", i);
      if (close === -1) {
        cur += html.slice(i);
        break;
      }
      const tag = html.slice(i, close + 1);
      if (/^<span[^>]*>$/.test(tag)) openTags.push(tag);
      else if (tag === "</span>") openTags.pop();
      cur += tag;
      i = close + 1;
      continue;
    }
    if (ch === "\n") {
      lines.push(cur + "</span>".repeat(openTags.length));
      cur = openTags.join("");
      i += 1;
      continue;
    }
    const next = html.slice(i).search(/[<\n]/);
    if (next === -1) {
      cur += html.slice(i);
      break;
    }
    cur += html.slice(i, i + next);
    i += next;
  }
  lines.push(cur + "</span>".repeat(openTags.length));
  return lines;
}

export function MarkdownView({ tab }: { tab: Tab }) {
  const { fontSize, fullWidth, viewMode, setViewMode } = useSettings();
  const { setEntries, setActive } = useToc();
  const setScrollInStore = useTabs((s) => s.setScroll);

  const baseDir = tab.path ? dirnameOf(tab.path) : undefined;
  const { html } = useMemo(() => {
    if (tab.error) return { html: "" };
    if (!tab.path) return { html: "" };
    try {
      return renderFull(tab.content, baseDir);
    } catch (e) {
      console.error("render failed:", e);
      return { html: "" };
    }
  }, [tab.content, tab.path, tab.error, baseDir]);

  // 代码视图:hljs 高亮原始 Markdown,按行包裹 span 并给标题行注入锚点 id,
  // 让左侧目录在代码模式下同样可用(TocSidebar 点击 → scrollIntoView 命中)。
  const { codeHtml, sourceHeadings } = useMemo(() => {
    if (viewMode !== "code" || tab.error || !tab.path) {
      return { codeHtml: "", sourceHeadings: [] as SourceHeading[] };
    }
    const headings = extractHeadingsFromSource(tab.content);
    let highlighted: string;
    try {
      highlighted = hljs.highlight(tab.content, { language: "markdown" }).value;
    } catch (e) {
      console.error("highlight failed:", e);
      return { codeHtml: "", sourceHeadings: headings };
    }
    const idByLine = new Map(headings.map((h) => [h.line, `mdc-h${h.line}`]));
    const codeHtml = splitHighlightedLines(highlighted)
      .map((l, i) => {
        const id = idByLine.get(i);
        return id
          ? `<span id="${id}" class="md-src-heading">${l}</span>`
          : `<span>${l}</span>`;
      })
      .join("\n");
    return { codeHtml, sourceHeadings: headings };
  }, [tab.content, tab.path, tab.error, viewMode]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const codePreRef = useRef<HTMLPreElement | null>(null);
  const lastTabIdRef = useRef(tab.id);
  const scrollRaf = useRef(0);
  // 滚动同步限流:scrollY 只低频写入 store(高频率会整树重渲染,滚动掉帧)。
  const lastScrollSyncRef = useRef(0);
  const userScrolledRef = useRef(false);

  // Post-render pass: TOC extraction, observer, copy buttons, link handlers.
  // 代码视图:目录从原始源码解析,滚动跟随观察代码里的标题行 span。
  useEffect(() => {
    if (viewMode === "code") {
      const pre = codePreRef.current;
      if (!pre || !tab.path) return;
      setEntries(sourceHeadings.map((h) => ({ id: `mdc-h${h.line}`, text: h.text, level: h.level })));
      const observer = new IntersectionObserver(
        (entriesObs) => {
          if (isObserverPaused()) return;
          for (const entry of entriesObs) {
            if (entry.isIntersecting) {
              setActive(entry.target.id);
              break;
            }
          }
        },
        { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
      );
      pre.querySelectorAll("span.md-src-heading").forEach((h) => observer.observe(h));
      // 卸载(切走/回首页)时清空目录;重挂载会立即重新提取
      return () => {
        observer.disconnect();
        setEntries([]);
      };
    }
    const article = articleRef.current;
    if (!article || !tab.path) return;

    setEntries(extractToc(article));

    const headings = article.querySelectorAll("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]");
    const observer = new IntersectionObserver(
      (entriesObs) => {
        if (isObserverPaused()) return;
        for (const entry of entriesObs) {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );
    headings.forEach((h) => observer.observe(h));

    // Code copy buttons.
    article.querySelectorAll("pre").forEach((pre) => {
      if (pre.querySelector(".code-copy-btn")) return;
      const btn = document.createElement("button");
      btn.className = "code-copy-btn";
      btn.textContent = "Copy";
      btn.addEventListener("click", () => {
        const code = pre.querySelector("code");
        const text = code?.textContent ?? pre.textContent ?? "";
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = "Copied!";
          setTimeout(() => (btn.textContent = "Copy"), 1500);
        });
      });
      pre.appendChild(btn);
    });

    // Link handling: external URLs → system browser; local paths → in-app
    // (markdown) or system (everything else).
    article.querySelectorAll("a[href]").forEach((el) => {
      const link = el as HTMLAnchorElement;
      const href = link.getAttribute("href") ?? "";
      if (!href || href.startsWith("#")) return;
      link.addEventListener("click", async (e) => {
        e.preventDefault();
        if (!tab.path || isUrlHref(href)) {
          try {
            await openUrl(href);
          } catch {
            window.open(href, "_blank");
          }
          return;
        }
        const resolved = resolveLocalPath(href, dirnameOf(tab.path as string));
        if (MD_EXTENSIONS.test(resolved)) {
          void useTabs.getState().openPath(resolved);
          return;
        }
        if (await pathExists(resolved).catch(() => false)) {
          await openPath(resolved).catch(() => {});
        } else {
          console.warn("链接目标不存在:", resolved);
        }
      });
    });

    return () => {
      observer.disconnect();
      // 卸载(切走/回首页)时清空目录;重挂载会立即重新提取
      setEntries([]);
    };
  }, [viewMode, html, codeHtml, sourceHeadings, tab.path, setEntries, setActive]);

  // Scroll restore on tab switch; keep position across content refreshes.
  // userScrolledRef:用户主动滚动后,scrollY 的低频回写不得再反推滚动位置。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (lastTabIdRef.current !== tab.id) {
      lastTabIdRef.current = tab.id;
      userScrolledRef.current = false;
      el.scrollTop = tab.scrollY;
    }
  }, [tab.id, tab.scrollY]);

  // Content (re)loaded: restore the saved scroll unless the user already scrolled.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (lastTabIdRef.current === tab.id && !userScrolledRef.current && tab.scrollY > 0 && el.scrollTop === 0) {
      el.scrollTop = tab.scrollY;
    }
  }, [html, tab.id, tab.scrollY]);

  // 滚动结束后把最终位置写入 store(scrollend)。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScrollEnd = () => {
      lastScrollSyncRef.current = performance.now();
      setScrollInStore(tab.id, el.scrollTop);
    };
    el.addEventListener("scrollend", onScrollEnd);
    return () => el.removeEventListener("scrollend", onScrollEnd);
  }, [tab.id, setScrollInStore]);

  if (!tab.path) {
    return <EmptyState />;
  }

  if (tab.error) {
    return (
      <Box flex={1} overflow="auto" p={8} display="flex" alignItems="flex-start" justifyContent="center">
        <Alert.Root status="error" maxW="560px" variant="subtle">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>无法打开 {tab.name}</Alert.Title>
            <Alert.Description>{tab.error}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      </Box>
    );
  }

  // 滚动:scrollY 限流写入 store(200ms),滚动结束(scrollend)立即落盘,
  // 避免每帧 store 更新引发整树重渲染而掉帧。
  const handleScroll = () => {
    userScrolledRef.current = true;
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      const el = scrollRef.current;
      if (!el) return;
      const now = performance.now();
      if (now - lastScrollSyncRef.current >= 200) {
        lastScrollSyncRef.current = now;
        setScrollInStore(tab.id, el.scrollTop);
      }
    });
  };

  return (
    <Box flex={1} position="relative" display="flex" minW={0}>
      <Box
        ref={scrollRef}
        className="no-scrollbar"
        flex={1}
        overflowY="auto"
        onScroll={handleScroll}
      >
        {viewMode === "code" ? (
          // 挂 md-body 类以复用 .md-body .hljs-* 亮/暗 token 配色。
          <div className="md-body md-code-view">
            <pre ref={codePreRef} className="md-code-pre">
              <code dangerouslySetInnerHTML={{ __html: codeHtml }} />
            </pre>
          </div>
        ) : (
          <article
            ref={articleRef}
            className="md-body"
            style={{
              maxWidth: fullWidth ? "100%" : "820px",
              margin: "0 auto",
              padding: "32px 48px 64px",
              fontSize,
              ["--md-font-size" as string]: `${fontSize}px`,
              transition: "max-width 0.25s ease, font-size 0.2s ease",
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </Box>
      <FloatingScrollbar targetRef={scrollRef} />
      {/* 视图切换:顶部贴合内容区右上,右侧留出悬浮滚动条(4px+12px)的位置。 */}
      <Box
        position="absolute"
        top="0"
        right="16px"
        zIndex={40}
        borderRadius="8px"
        borderWidth="1px"
        borderColor="border.subtle"
        bg="bg.panel"
        boxShadow="sm"
        backdropFilter="blur(8px)"
      >
        <SegmentGroup.Root
          size="xs"
          value={viewMode}
          onValueChange={(e) => {
            const next = e.value as ViewMode;
            withViewTransition(() => setViewMode(next));
          }}
          aria-label="切换预览或代码视图"
        >
          <SegmentGroup.Indicator />
          <SegmentGroup.Item value="preview">
            <SegmentGroup.ItemHiddenInput />
            <SegmentGroup.ItemText display="inline-flex" alignItems="center" gap={1.5}>
              <Eye size={13} />
              预览
            </SegmentGroup.ItemText>
          </SegmentGroup.Item>
          <SegmentGroup.Item value="code">
            <SegmentGroup.ItemHiddenInput />
            <SegmentGroup.ItemText display="inline-flex" alignItems="center" gap={1.5}>
              <Code2 size={13} />
              代码
            </SegmentGroup.ItemText>
          </SegmentGroup.Item>
        </SegmentGroup.Root>
      </Box>
    </Box>
  );
}
