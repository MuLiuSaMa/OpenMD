import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Box, Button, Flex, SegmentGroup } from "@chakra-ui/react";
import {
  Code2,
  ClipboardPaste,
  Copy,
  Eye,
  ExternalLink,
  Image as ImageIcon,
  ImagePlus,
  Link2,
  Pencil,
  Redo2,
  Replace,
  Save,
  Scissors,
  Undo2,
} from "lucide-react";
import i18n from "i18next";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl, openPath } from "@tauri-apps/plugin-opener";
import {
  dirnameOf,
  frontmatterLineOffset,
  renderFull,
  resolveLocalPath,
} from "../renderer/pipeline";
import { articleToMarkdown } from "../renderer/backconvert";
import { renderMermaidBlocks } from "../renderer/mermaid";
import { applyLinePatches, collectPatches, patchFromBlock, shiftForLine } from "../renderer/previewEdit";
import {
  copyImage,
  copySelection,
  isLocalImageSrc,
  readClipboardText,
  selectionText,
} from "../renderer/clipboard";
import hljs from "../renderer/hljs";
import { extractToc, isObserverPaused, useToc } from "../stores/toc";
import { allowAssets, importImage, openImageDialog, pathExists } from "../tauri/api";
import { useTabs, type Tab } from "../stores/tabs";
import { useSettings, type ViewMode } from "../stores/settings";
import { withViewTransition } from "../utils/viewTransition";
import { ContextMenu, type MenuEntry } from "./ContextMenu";
import { EmptyState } from "./EmptyState";
import { FloatingScrollbar } from "./FloatingScrollbar";

const MD_EXTENSIONS = /\.(md|markdown|mdown|mkd)$/i;

/** 右键菜单里的一行按钮组(大小/字号/布局),替代一长串菜单项。 */
function MenuRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Flex
      px={3}
      h="32px"
      alignItems="center"
      gap={1}
      fontSize="xs"
      color="fg.muted"
      userSelect="none"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <Box as="span" flexShrink={0} w="32px">
        {label}
      </Box>
      {children}
    </Flex>
  );
}

function MenuOpt({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Box
      as="button"
      px={1.5}
      h="22px"
      fontSize="2xs"
      borderRadius="5px"
      borderWidth="1px"
      borderColor={active ? "fg" : "transparent"}
      bg={active ? "bg.subtle" : "transparent"}
      color={active ? "fg" : "fg.muted"}
      flexShrink={0}
      // 不转移焦点、不清正文选区(字号/布局依赖选区)。
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Box>
  );
}

/** 右键菜单里的步进器行:- 数字单位 +(回车/失焦应用,± 与箭头即时生效)。 */
function MenuStepper({
  label,
  unit,
  value,
  step = 16,
  min = 16,
  max = 10000,
  onApply,
}: {
  label: string;
  unit: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onApply: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const lastAppliedRef = useRef<number | null>(null);
  const applyValue = (n: number) => {
    const clamped = Math.min(Math.max(n, min), max);
    if (lastAppliedRef.current === clamped) return;
    lastAppliedRef.current = clamped;
    onApply(clamped);
  };
  const commit = () => {
    const n = Number.parseInt(text, 10);
    if (Number.isFinite(n)) applyValue(n);
  };
  const stepFn = (d: number) => {
    const n = Math.max(min, Math.min(max, (Number.parseInt(text, 10) || value) + d));
    setText(String(n));
    applyValue(n);
  };
  return (
    <MenuRow label={label}>
      <MenuOpt onClick={() => stepFn(-step)}>−</MenuOpt>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        // 原生上下箭头(mouseup)与键盘上下键(keyup):步进完成后应用当前值。
        onMouseUp={() => commit()}
        onKeyUp={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") commit();
        }}
        onBlur={() => commit()}
        style={{
          width: 60,
          height: 22,
          padding: "0 6px",
          fontSize: 12,
          background: "transparent",
          border: "1px solid rgba(127,127,127,0.4)",
          borderRadius: 5,
          color: "inherit",
          outline: "none",
        }}
      />
      <Box as="span" flexShrink={0}>
        {unit}
      </Box>
      <MenuOpt onClick={() => stepFn(step)}>+</MenuOpt>
    </MenuRow>
  );
}

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
  const { t } = useTranslation();
  const { fontSize, fullWidth, viewMode, setViewMode, editMode, toggleEditMode } = useSettings();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const { setEntries, setActive } = useToc();
  const setScrollInStore = useTabs((s) => s.setScroll);
  const updateDraft = useTabs((s) => s.updateDraft);
  const saveTab = useTabs((s) => s.saveTab);

  const editing = editMode && tab.path !== null;
  const dirty = tab.draft !== null && tab.draft !== tab.content;

  const baseDir = tab.path ? dirnameOf(tab.path) : undefined;
  // 预览的渲染源。编辑期间预览打字只更新 store 里的 draft,不跟进
  // previewSource(deps 故意不含 draft),否则 React 会重设 innerHTML、光标丢失;
  // 它只在边界时刻同步:挂载、外部重载、视图切换、编辑开关切换。
  const [previewSource, setPreviewSource] = useState(() => tab.draft ?? tab.content);
  useEffect(() => {
    const t = useTabs.getState().tabs.find((x) => x.id === tab.id);
    const src = t?.draft ?? t?.content ?? "";
    // 草稿相对已保存内容新增了图片引用时(代码视图新写/预览编辑),先把它们
    // 写进 asset 白名单再提交渲染源;否则首帧请求会被拒且 <img> 不重试。
    if (!t?.path || t.draft === null || t.draft === t.content) {
      setPreviewSource(src);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const r = renderFull(src, dirnameOf(t.path as string));
        await allowAssets(t.path as string, r.assetPaths);
      } catch (e) {
        console.error("asset preflight failed:", e);
      }
      if (alive) setPreviewSource(src);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在边界时刻同步
  }, [tab.content, tab.id, viewMode, editMode]);
  const { html, assetPaths } = useMemo(() => {
    if (tab.error) return { html: "", assetPaths: [] as string[] };
    if (!tab.path) return { html: "", assetPaths: [] as string[] };
    try {
      return renderFull(previewSource, baseDir);
    } catch (e) {
      console.error("render failed:", e);
      return { html: "", assetPaths: [] as string[] };
    }
  }, [previewSource, tab.error, tab.path, baseDir]);

  // 代码视图:编辑时高亮层跟随 draft 实时刷新(输入 → store → 重高亮)。
  const codeSource = tab.draft ?? tab.content;
  const { codeHtml, sourceHeadings } = useMemo(() => {
    if (viewMode !== "code" || tab.error || !tab.path) {
      return { codeHtml: "", sourceHeadings: [] as SourceHeading[] };
    }
    const headings = extractHeadingsFromSource(codeSource);
    let highlighted: string;
    try {
      highlighted = hljs.highlight(codeSource, { language: "markdown" }).value;
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
  }, [codeSource, tab.path, tab.error, viewMode]);

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

    // Mermaid 图表:阅读态把 ```mermaid 代码块替换成渲染好的 SVG;编辑态
    // 保留可编辑代码块(改完切回阅读即见新图)。主题切换后 effect 重跑,
    // 已渲染容器按存下的源码重建。异步进行,容器被重渲染替换后自动放弃。
    if (!editing) {
      void renderMermaidBlocks(article, isDark).catch((e) =>
        console.error("mermaid render failed:", e),
      );
    }

    // 兜底自愈:若有图片请求仍抢在白名单写入之前到达(未被上层路径覆盖的
    // 时序),它会被拒且 <img> 不重试。白名单就绪后,对仍处于失败状态
    // (complete 且 naturalWidth 为 0)的本地图重发一次请求。
    if (tab.path && assetPaths.length > 0) {
      const docPath = tab.path;
      void allowAssets(docPath, assetPaths)
        .catch(() => {})
        .then(() => {
          article.querySelectorAll("img").forEach((img) => {
            if (!isLocalImageSrc(img.currentSrc || img.src)) return;
            if (img.complete && img.naturalWidth === 0) {
              img.src = img.getAttribute("src") ?? img.src;
            }
          });
        });
    }

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
      // mermaid 错误框里的 pre 是提示信息,不是可复制的源码
      if (pre.closest(".md-mermaid")) return;
      if (pre.querySelector(".code-copy-btn")) return;
      const btn = document.createElement("button");
      btn.className = "code-copy-btn";
      btn.textContent = i18n.t("viewer.code.copy");
      btn.addEventListener("click", () => {
        const code = pre.querySelector("code");
        const text = code?.textContent ?? pre.textContent ?? "";
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = i18n.t("viewer.code.copied");
          setTimeout(() => (btn.textContent = i18n.t("viewer.code.copy")), 1500);
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
        // 编辑模式下点击是为了放置光标,不打开链接。
        if (editMode) return;
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
  }, [viewMode, html, codeHtml, sourceHeadings, tab.path, editMode, isDark, assetPaths, setEntries, setActive]);

  // 预览编辑:contentEditable 的变更 → 段落级映射回源码草稿。预览 DOM 不重渲染,
  // 光标不丢;400ms 去抖把同一块的多条变更合并成一次替换。行号在 patch 间会漂移,
  // 由 applyLinePatches 的累计 delta + 事后重 stamp 属性保证下一轮仍能定位。
  // 图片缩放/替换这类属性变更 MutationObserver 收不到,走 dirtyBlocksRef 手动入队。
  const previewMutationsRef = useRef<MutationRecord[]>([]);
  const dirtyBlocksRef = useRef<Set<HTMLElement>>(new Set());
  const patchTimerRef = useRef(0);
  const flushPreviewEdits = useCallback(() => {
    window.clearTimeout(patchTimerRef.current);
    patchTimerRef.current = 0;
    const article = articleRef.current;
    if (!article || !tab.path) return;
    const pending = previewMutationsRef.current;
    previewMutationsRef.current = [];
    // React 重设 innerHTML 会产生 target=article、同时有增有删的整树替换记录,
    // 那不是用户编辑,整批丢弃(下一轮输入即恢复正常)。
    if (pending.some((m) => m.target === article && m.removedNodes.length > 0 && m.addedNodes.length > 0)) {
      dirtyBlocksRef.current.clear();
      return;
    }
    const state = useTabs.getState();
    const t = state.tabs.find((x) => x.id === tab.id);
    if (!t) return;
    const res = collectPatches(article, pending);
    for (const el of Array.from(dirtyBlocksRef.current)) {
      dirtyBlocksRef.current.delete(el);
      if (!article.contains(el)) continue;
      const patch = patchFromBlock(el);
      if (patch) res.patches.push(patch);
    }
    res.patches.sort((a, b) => a.start - b.start);
    if (res.fallback) {
      // 少数无法定位的变更:整篇降级转换,保证编辑不丢。
      console.warn("preview edit: 段落定位失败,整篇转换");
      state.setDraft(tab.id, articleToMarkdown(article));
      return;
    }
    if (res.patches.length === 0) return;
    const source = t.draft ?? t.content;
    const applied = applyLinePatches(source, res.patches, frontmatterLineOffset(source));
    state.setDraft(tab.id, applied.text);
    for (const rm of applied.remapped) {
      rm.el.dataset.sourceLine = String(rm.start);
      rm.el.dataset.sourceEnd = String(rm.end);
    }
    const patched = new Set(applied.remapped.map((r) => r.el));
    article.querySelectorAll<HTMLElement>("[data-source-line]").forEach((el) => {
      if (patched.has(el)) return;
      const s = Number(el.dataset.sourceLine);
      const d = shiftForLine(applied.shifts, s);
      el.dataset.sourceLine = String(s + d);
      el.dataset.sourceEnd = String(Number(el.dataset.sourceEnd ?? s) + d);
    });
  }, [tab.id, tab.path]);
  const schedulePreviewPatch = useCallback(() => {
    if (patchTimerRef.current) return;
    patchTimerRef.current = window.setTimeout(flushPreviewEdits, 250);
  }, [flushPreviewEdits]);
  /** 程序化改动(缩放/替换图片)后手动把所在块标记为待重转换。 */
  const markBlockDirty = useCallback(
    (el: Element) => {
      const block = el.closest<HTMLElement>("[data-source-line]");
      if (!block || block.parentElement !== articleRef.current) return;
      dirtyBlocksRef.current.add(block);
      schedulePreviewPatch();
    },
    [schedulePreviewPatch],
  );

  // 图片属性类修改(缩放/替换)不进浏览器的撤销栈,自建一层。规则:一旦发生
  // 原生编辑(打字),这层作废、清空,撤销交回浏览器栈——保证两条栈不打架。
  interface ImageUndoOp {
    revert: () => void;
    apply: () => void;
  }
  const imgUndoRef = useRef<ImageUndoOp[]>([]);
  const imgRedoRef = useRef<ImageUndoOp[]>([]);
  /** 最近一次字号应用的 px;用于把撤销/重放出来的标记 span 修回目标值。 */
  const lastFontPxRef = useRef<number | null>(null);
  const fixMarkerSpans = useCallback(
    (px: number | null) => {
      const article = articleRef.current;
      if (!article || px === null) return;
      article.querySelectorAll<HTMLElement>('span[style*="font-size"]').forEach((el) => {
        if (el.style.fontSize.includes("xxx-large")) {
          el.style.fontSize = `${px}px`;
          markBlockDirty(el);
        }
      });
    },
    [markBlockDirty],
  );
  const pushImageOp = useCallback(
    <V,>(img: HTMLImageElement, mutate: (v: V) => void, before: V, after: V) => {
      const block = img.closest<HTMLElement>("[data-source-line]");
      const mark = () => {
        if (block && block.parentElement === articleRef.current) {
          dirtyBlocksRef.current.add(block);
          schedulePreviewPatch();
        }
      };
      const op: ImageUndoOp = {
        revert: () => {
          mutate(before);
          mark();
        },
        apply: () => {
          mutate(after);
          mark();
        },
      };
      imgUndoRef.current.push(op);
      imgRedoRef.current = [];
      mutate(after);
      mark();
    },
    [schedulePreviewPatch],
  );
  const menuUndo = useCallback(() => {
    const op = imgUndoRef.current.pop();
    if (op) {
      imgRedoRef.current.push(op);
      op.revert();
      return;
    }
    // 菜单点击让正文失焦,execCommand 需要编辑区持有焦点才生效。
    articleRef.current?.focus();
    document.execCommand("undo");
    // 原生重放字号命令会带出标记 span,修回目标 px。
    fixMarkerSpans(lastFontPxRef.current);
  }, [fixMarkerSpans]);
  const menuRedo = useCallback(() => {
    const op = imgRedoRef.current.pop();
    if (op) {
      imgUndoRef.current.push(op);
      op.apply();
      return;
    }
    articleRef.current?.focus();
    document.execCommand("redo");
    fixMarkerSpans(lastFontPxRef.current);
  }, [fixMarkerSpans]);
  // 外部重载后操作记录失效。
  useEffect(() => {
    imgUndoRef.current = [];
    imgRedoRef.current = [];
  }, [tab.content]);

  // Ctrl+Z / Ctrl+Y(Ctrl+Shift+Z)统一路由:自建栈优先;否则走原生撤销/重做
  // 并修复字号标记 span。直接放行原生会漏掉标记修复,所以一律接管。
  useEffect(() => {
    if (!editing || viewMode !== "preview") return;
    const onUndoKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        menuUndo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        menuRedo();
      }
    };
    window.addEventListener("keydown", onUndoKey);
    return () => window.removeEventListener("keydown", onUndoKey);
  }, [editing, viewMode, menuUndo, menuRedo]);
  useEffect(() => {
    if (!editing || viewMode !== "preview") return;
    const article = articleRef.current;
    if (!article || !tab.path) return;
    const observer = new MutationObserver((muts) => {
      // 原生编辑(打字/insertHTML/字号命令)发生后,图片属性操作的自建撤销栈作废。
      imgUndoRef.current = [];
      imgRedoRef.current = [];
      previewMutationsRef.current.push(...muts);
      schedulePreviewPatch();
    });
    observer.observe(article, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      flushPreviewEdits(); // 切视图/卸载前把未落盘的编辑写进草稿
    };
  }, [editing, viewMode, tab.id, tab.path, schedulePreviewPatch, flushPreviewEdits]);

  // ---- 内容区右键菜单(替代 WebView2 默认菜单)与图片编辑 ----
  const [menu, setMenu] = useState<{ x: number; y: number; target: Element } | null>(null);
  const [resizeHandle, setResizeHandle] = useState<{
    img: HTMLImageElement;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const codeTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  /** 选图 → 归档到文档目录(已在目录内则原地引用)→ 拿到 markdown 相对路径与 asset URL。 */
  const pickImage = useCallback(async (): Promise<{ rel: string; src: string } | null> => {
    if (!tab.path) return null;
    const abs = await openImageDialog();
    if (!abs) return null;
    const imported = await importImage(tab.path, abs);
    await allowAssets(tab.path, [imported.abs]).catch((e) => console.error("asset allow failed:", e));
    return { rel: imported.rel, src: convertFileSrc(imported.abs) };
  }, [tab.path]);

  /** 预览:在当前光标处插入图片(光标不在文档内则定位到文末插入)。
   *  统一走 execCommand("insertHTML"),天然进入浏览器撤销栈。 */
  const insertImageAtCaret = useCallback(async () => {
    const picked = await pickImage();
    const article = articleRef.current;
    if (!picked || !article) return;
    const html = `<img src="${escapeAttr(picked.src)}" data-original-src="${escapeAttr(picked.rel)}" alt="${t("viewer.image.alt")}">`;
    article.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !article.contains(sel.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(article);
      range.collapse(false); // 光标移到文末
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    document.execCommand("insertHTML", false, html);
  }, [pickImage]);

  const replaceImage = useCallback(
    async (img: HTMLImageElement) => {
      const picked = await pickImage();
      if (!picked) return;
      const before: [string, string] = [
        img.getAttribute("src") ?? "",
        img.dataset.originalSrc ?? "",
      ];
      const after: [string, string] = [picked.src, picked.rel];
      pushImageOp(
        img,
        (v: [string, string]) => {
          img.setAttribute("src", v[0]);
          img.dataset.originalSrc = v[1];
        },
        before,
        after,
      );
    },
    [pickImage, pushImageOp],
  );

  /** 缩放:ratio 用于预设(1 = 清除 width 回原始),px 用于自定义。
   *  属性修改不进浏览器的 contentEditable 撤销栈,自建一层图片操作栈。 */
  const resizeImage = useCallback(
    (img: HTMLImageElement, ratio?: number, px?: number) => {
      if (px === undefined && ratio === undefined) return;
      const oldWidth = img.getAttribute("width");
      const newWidth = ratio === 1 ? null : String(px ?? Math.max(16, Math.round(img.naturalWidth * (ratio ?? 1))));
      pushImageOp(
        img,
        (v: string | null) => (v === null ? img.removeAttribute("width") : img.setAttribute("width", v)),
        oldWidth,
        newWidth,
      );
    },
    [pushImageOp],
  );

  // 代码视图 textarea 的剪贴板操作(setRangeText;粘贴来自插件读取)。
  const textareaCopy = useCallback(
    (op: "copy" | "cut") => {
      const ta = codeTextareaRef.current;
      if (!ta) return;
      ta.focus(); // 菜单点击让 textarea 失焦,先还原焦点再取选区。
      const text = codeSource.slice(ta.selectionStart, ta.selectionEnd);
      if (!text) return;
      void navigator.clipboard.writeText(text).catch(() => {});
      if (op === "cut") {
        updateDraft(tab.id, codeSource.slice(0, ta.selectionStart) + codeSource.slice(ta.selectionEnd));
      }
    },
    [codeSource, tab.id, updateDraft],
  );
  const textareaPaste = useCallback(async () => {
    const ta = codeTextareaRef.current;
    if (!ta) return;
    const text = await readClipboardText();
    if (!text) return;
    const start = ta.selectionStart;
    updateDraft(tab.id, codeSource.slice(0, start) + text + codeSource.slice(ta.selectionEnd));
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + text.length;
    });
  }, [codeSource, tab.id, updateDraft]);

  // 菜单打开时的选区快照:点进输入框/菜单会丢失正文选区,依赖选区的操作
  // (字号/布局/加粗/剪切/复制)先从这里恢复。Range 是活对象,会随编辑自动调整。
  const menuSelRangeRef = useRef<Range | null>(null);
  const restoreMenuSelection = useCallback((): boolean => {
    const article = articleRef.current;
    const sel = window.getSelection();
    const saved = menuSelRangeRef.current;
    if (!article || !sel || !saved) return false;
    try {
      if (!article.contains(saved.commonAncestorContainer)) return false;
      // 无条件从快照恢复:活选区在输入框/菜单交互后状态不可信,
      // 每次应用都确定地落在右键时的同一段文字上。
      sel.removeAllRanges();
      sel.addRange(saved);
      return !sel.isCollapsed;
    } catch {
      return false;
    }
  }, []);

  /** 选区字号:走浏览器原生 execCommand("fontSize")——它能正确处理跨元素、
   *  部分选区并进入原生撤销栈。三步:styleWithCSS 打开 CSS 模式 → fontSize 7
   *  给选区打出 xxx-large 标记 span → 把标记统一修回目标 px。连续调整的关键:
   *  应用后用标记 span 的范围刷新快照(原 Range 引用的文字节点被命令拆散,
   *  不刷新下一次恢复的就是塌陷选区)。 */
  const applySelectionFontSize = useCallback(
    (px: number) => {
      const article = articleRef.current;
      if (!article) return;
      article.focus();
      if (!restoreMenuSelection()) return;
      lastFontPxRef.current = px;
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("fontSize", false, "7"); // 打标记,标记 span 由此产生
      fixMarkerSpans(px);
      // 应用后刷新快照 + 把选区套回正文(视觉保持高亮)。
      try {
        const sel2 = window.getSelection();
        // 只找本次选区范围内的标记 span(文档里可能有更早调整过的)。
        const sel = window.getSelection();
        const anchor =
          sel && sel.rangeCount > 0
            ? sel.anchorNode instanceof Element
              ? sel.anchorNode
              : sel.anchorNode?.parentElement
            : null;
        const target = anchor?.closest<HTMLElement>('span[style*="font-size"]');
        if (sel2 && target && article.contains(target)) {
          const r = document.createRange();
          r.selectNodeContents(target);
          sel2.removeAllRanges();
          sel2.addRange(r);
          menuSelRangeRef.current = r.cloneRange();
        }
      } catch {
        /* 选区刷新失败不影响应用本身 */
      }
    },
    [fixMarkerSpans, restoreMenuSelection],
  );

  /** 选区所在块的对齐:写 align 属性(p/h/div),清除传 null。
   *  属性修改不进浏览器撤销栈,同样接入自建操作栈(整组一次撤销)。 */
  const alignSelectedBlocks = useCallback(
    (align: "left" | "center" | "right" | null) => {
      const article = articleRef.current;
      if (!article) return;
      article.focus();
      if (!restoreMenuSelection()) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const touched: HTMLElement[] = [];
      for (const block of Array.from(article.children)) {
        if (block instanceof HTMLElement && range.intersectsNode(block)) touched.push(block);
      }
      if (touched.length === 0) return;
      const states = touched.map((b) => ({ b, before: b.getAttribute("align") }));
      const applyOp = () => {
        states.forEach(({ b }) => {
          if (align) b.setAttribute("align", align);
          else b.removeAttribute("align");
          markBlockDirty(b);
        });
      };
      const revertOp = () => {
        states.forEach(({ b, before }) => {
          if (before) b.setAttribute("align", before);
          else b.removeAttribute("align");
          markBlockDirty(b);
        });
      };
      imgUndoRef.current.push({ revert: revertOp, apply: applyOp });
      imgRedoRef.current = [];
      applyOp();
      // 不清选区:重开菜单时布局高亮仍可读。
    },
    [markBlockDirty],
  );

  /** 按右键位置/目标构建菜单条目。 */
  const buildMenuEntries = useCallback(
    (target: Element): MenuEntry[] => {
      const img = target.closest("img");
      const link = target.closest("a");
      const sel = selectionText();

      if (!editing) {
        const entries: MenuEntry[] = [
          {
            type: "item",
            label: t("viewer.menu.copy"),
            icon: <Copy size={14} />,
            disabled: sel.length === 0,
            onClick: () => void copySelection().catch(() => {}),
          },
        ];
        if (img) {
          entries.push(
            {
              type: "item",
              label: t("viewer.menu.copyImage"),
              icon: <ImageIcon size={14} />,
              // 远程图受 CORS 限制,复制到剪贴板大概率失败,只留"复制地址"。
              disabled: !isLocalImageSrc(img.currentSrc || img.src),
              onClick: () => void copyImage(img).catch((e) => console.warn("复制图片失败:", e)),
            },
            {
              type: "item",
              label: t("viewer.menu.copyImageAddress"),
              icon: <Link2 size={14} />,
              onClick: () =>
                void navigator.clipboard
                  .writeText(img.getAttribute("data-original-src") ?? img.src)
                  .catch(() => {}),
            },
          );
        }
        const href = link?.getAttribute("href");
        if (href) {
          entries.push({
            type: "item",
            label: t("viewer.menu.openLink"),
            icon: <ExternalLink size={14} />,
            onClick: () => void openUrl(href),
          });
        }
        entries.push(
          { type: "sep" },
          {
            type: "item",
            label: t("viewer.menu.selectAll"),
            onClick: () => {
              const scope = articleRef.current ?? target;
              window.getSelection()?.selectAllChildren(scope);
            },
          },
        );
        return entries;
      }

      if (viewMode === "code") {
        const ta = codeTextareaRef.current;
        const hasSel = !!ta && ta.selectionStart < ta.selectionEnd;
        return [
          { type: "item", label: t("viewer.menu.cut"), icon: <Scissors size={14} />, disabled: !hasSel, onClick: () => textareaCopy("cut") },
          { type: "item", label: t("viewer.menu.copy"), icon: <Copy size={14} />, disabled: !hasSel, onClick: () => textareaCopy("copy") },
          { type: "item", label: t("viewer.menu.paste"), icon: <ClipboardPaste size={14} />, onClick: () => void textareaPaste() },
          { type: "sep" },
          {
            type: "item",
            label: t("viewer.menu.selectAll"),
            onClick: () => {
              ta?.focus();
              ta?.select();
            },
          },
        ];
      }

      // 编辑开 + 预览
      const entries: MenuEntry[] = [
        { type: "item", label: t("viewer.menu.undo"), icon: <Undo2 size={14} />, onClick: menuUndo },
        { type: "item", label: t("viewer.menu.redo"), icon: <Redo2 size={14} />, onClick: menuRedo },
        { type: "sep" },
        {
          type: "item",
          label: t("viewer.menu.cut"),
          icon: <Scissors size={14} />,
          disabled: sel.length === 0,
          onClick: () => {
            articleRef.current?.focus();
            restoreMenuSelection();
            document.execCommand("cut");
          },
        },
        {
          type: "item",
          label: t("viewer.menu.copy"),
          icon: <Copy size={14} />,
          disabled: sel.length === 0,
          onClick: () => {
            articleRef.current?.focus();
            restoreMenuSelection();
            document.execCommand("copy");
          },
        },
        { type: "item", label: t("viewer.menu.paste"), icon: <ClipboardPaste size={14} />, onClick: () => void pasteIntoPreview() },
        { type: "sep" },
        { type: "item", label: t("viewer.menu.insertImage"), icon: <ImagePlus size={14} />, onClick: () => void insertImageAtCaret() },
      ];
      if (sel.length > 0) {
        // 选中文本:排版(加粗进浏览器撤销栈;字号 span / 对齐 align 由段落映射回源码)。
        // 选区起始块的对齐状态用于高亮当前布局;起始处计算字号作为步进器初值。
        const selBlockAlign =
          sel && window.getSelection()?.anchorNode
            ? ((window.getSelection()!.anchorNode instanceof Element
                ? (window.getSelection()!.anchorNode as Element)
                : window.getSelection()!.anchorNode!.parentElement
              )?.closest("[align]")?.getAttribute("align") ?? null)
            : null;
        const selFontPx = (() => {
          const s = window.getSelection();
          const node = s?.anchorNode;
          const el = node instanceof Element ? node : node?.parentElement;
          if (!el || !articleRef.current?.contains(el)) return undefined;
          const px = Number.parseFloat(getComputedStyle(el).fontSize);
          return Number.isFinite(px) ? Math.round(px) : undefined;
        })();
        entries.push(
          { type: "sep" },
          {
            type: "item",
            label: t("viewer.menu.bold"),
            hint: "Ctrl+B",
            onClick: () => {
              articleRef.current?.focus();
              restoreMenuSelection();
              document.execCommand("bold");
            },
          },
          {
            type: "custom",
            node: (
              <MenuStepper
                label={t("viewer.menu.fontSize")}
                unit="px"
                value={selFontPx ?? 17}
                step={2}
                min={8}
                max={96}
                onApply={(px) => applySelectionFontSize(px)}
              />
            ),
          },
          {
            type: "custom",
            node: (
              <MenuRow label={t("viewer.menu.layout")}>
                <MenuOpt active={selBlockAlign === "left"} onClick={() => { alignSelectedBlocks("left"); setMenu(null); }}>{t("viewer.menu.alignLeft")}</MenuOpt>
                <MenuOpt active={selBlockAlign === "center"} onClick={() => { alignSelectedBlocks("center"); setMenu(null); }}>{t("viewer.menu.alignCenter")}</MenuOpt>
                <MenuOpt active={selBlockAlign === "right"} onClick={() => { alignSelectedBlocks("right"); setMenu(null); }}>{t("viewer.menu.alignRight")}</MenuOpt>
                <MenuOpt active={selBlockAlign === null} onClick={() => { alignSelectedBlocks(null); setMenu(null); }}>{t("viewer.menu.alignDefault")}</MenuOpt>
              </MenuRow>
            ),
          },
        );
      }
      if (img) {
        entries.push({ type: "item", label: t("viewer.menu.replaceImage"), icon: <Replace size={14} />, onClick: () => void replaceImage(img) });
        entries.push({ type: "sep" });
        const wAttr = img.getAttribute("width");
        const natural = img.naturalWidth || 0;
        entries.push(
          {
            type: "custom",
            node: (
              <MenuStepper
                label={t("viewer.menu.size")}
                unit="px"
                value={wAttr ? Number(wAttr) : natural || 300}
                onApply={(px) => resizeImage(img, undefined, px)}
              />
            ),
          },
        );
      }
      return entries;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 菜单条目依赖众多动作回调,均为稳定 useCallback
    [editing, viewMode, menuUndo, menuRedo, insertImageAtCaret, replaceImage, resizeImage, textareaCopy, textareaPaste, applySelectionFontSize, alignSelectedBlocks, restoreMenuSelection],
  );

  const pasteIntoPreview = useCallback(async () => {
    const text = await readClipboardText();
    if (!text) return;
    articleRef.current?.focus();
    document.execCommand("insertText", false, text);
  }, []);

  const onContentContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!tab.path) return;
      // 记录打开菜单时的选区快照,供输入框/菜单交互后恢复。
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        menuSelRangeRef.current = sel.getRangeAt(0).cloneRange();
      }
      setMenu({ x: e.clientX, y: e.clientY, target: e.target as Element });
    },
    [tab.path],
  );

  /** 悬停图片时定位拖拽手柄(仅编辑+预览)。 */
  const onArticleMouseOver = useCallback(
    (e: React.MouseEvent) => {
      if (!editing || viewMode !== "preview") return;
      const img = (e.target as Element).closest("img");
      if (!img) {
        setResizeHandle((h) => (h ? null : h));
        return;
      }
      const r = img.getBoundingClientRect();
      setResizeHandle({ img, x: r.left, y: r.top, w: r.width, h: r.height });
    },
    [editing, viewMode],
  );

  const startImageResize = useCallback(
    (e: React.MouseEvent, item: NonNullable<typeof resizeHandle>) => {
      e.preventDefault();
      e.stopPropagation();
      const img = item.img;
      const startX = e.clientX;
      const startW = img.getBoundingClientRect().width;
      const onMove = (ev: MouseEvent) => {
        const maxW = articleRef.current?.getBoundingClientRect().width ?? startW;
        img.style.width = `${Math.max(16, Math.min(startW + (ev.clientX - startX), maxW))}px`;
        const r = img.getBoundingClientRect();
        setResizeHandle({ img, x: r.left, y: r.top, w: r.width, h: r.height });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const w = Math.round(parseFloat(img.style.width) || startW);
        img.style.width = "";
        // 走 resizeImage:拖拽提交和菜单缩放一样进自建撤销栈。
        resizeImage(img, undefined, w);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [resizeImage],
  );

  // 切视图/关编辑时收起手柄与菜单。
  useEffect(() => {
    setResizeHandle((h) => (h ? null : h));
    setMenu((m) => (m ? null : m));
  }, [editing, viewMode, tab.id]);

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
            <Alert.Title>{t("viewer.error.cannotOpen", { name: tab.name })}</Alert.Title>
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
    setResizeHandle((h) => (h ? null : h));
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
        onContextMenu={onContentContextMenu}
      >
        {viewMode === "code" ? (
          // 挂 md-body 类以复用 .md-body .hljs-* 亮/暗 token 配色。
          <div className="md-body md-code-view">
            {/* 高亮层与透明 textarea 网格叠放,编辑时视觉不变、光标可输入。 */}
            <div className="md-code-editor">
              <pre ref={codePreRef} className="md-code-pre" aria-hidden={editing || undefined}>
                <code dangerouslySetInnerHTML={{ __html: codeHtml }} />
              </pre>
              {editing && (
                <textarea
                  ref={codeTextareaRef}
                  className="md-code-textarea"
                  value={codeSource}
                  spellCheck={false}
                  onChange={(e) => updateDraft(tab.id, e.target.value)}
                />
              )}
            </div>
          </div>
        ) : (
          <article
            ref={articleRef}
            className="md-body"
            contentEditable={editing || undefined}
            suppressContentEditableWarning
            onMouseOver={onArticleMouseOver}
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
      {/* 图片拖拽手柄:视口定位在图片右下角,拖动实时调宽。 */}
      {resizeHandle && editing && viewMode === "preview" && (
        <Box
          position="fixed"
          zIndex={50}
          w="12px"
          h="12px"
          borderWidth="1.5px"
          borderColor="fg"
          bg="bg.panel"
          borderRadius="3px"
          cursor="nwse-resize"
          boxShadow="sm"
          style={{
            left: `${resizeHandle.x + resizeHandle.w - 6}px`,
            top: `${resizeHandle.y + resizeHandle.h - 6}px`,
          }}
          onMouseDown={(e) => startImageResize(e, resizeHandle)}
        />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={buildMenuEntries(menu.target)}
          onClose={() => setMenu(null)}
        />
      )}
      {/* 左上角:编辑开关 + 保存,紧贴内容区左缘,与右上角 预览/代码 滑块对应。 */}
      <Box
        position="absolute"
        top="0"
        left="0"
        zIndex={40}
        borderRadius="8px"
        borderWidth="1px"
        borderColor="border.subtle"
        bg="bg.panel"
        boxShadow="sm"
        backdropFilter="blur(8px)"
        display="flex"
        alignItems="center"
        p="2px"
        gap="2px"
      >
        <Button
          aria-label={t("viewer.toolbar.toggleEdit")}
          title={t("viewer.toolbar.editTitle")}
          size="xs"
          variant="ghost"
          gap={1.5}
          px={2}
          bg={editMode ? "fg" : "transparent"}
          color={editMode ? "bg" : "fg"}
          _hover={{ bg: editMode ? "fg.muted" : "bg.subtle" }}
          onClick={toggleEditMode}
        >
          <Pencil size={13} />
          {t("viewer.toolbar.edit")}
        </Button>
        <Button
          aria-label={t("viewer.toolbar.saveShortcut")}
          title={t("viewer.toolbar.saveShortcut")}
          size="xs"
          variant="ghost"
          gap={1.5}
          px={2}
          disabled={!dirty}
          onClick={() => void saveTab(tab.id)}
        >
          <Save size={13} />
          {t("viewer.toolbar.save")}
        </Button>
      </Box>
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
        display="flex"
        alignItems="center"
        p="2px"
      >
        <SegmentGroup.Root
          size="xs"
          value={viewMode}
          onValueChange={(e) => {
            const next = e.value as ViewMode;
            withViewTransition(() => setViewMode(next));
          }}
          aria-label={t("viewer.toolbar.switchView")}
        >
          <SegmentGroup.Indicator />
          <SegmentGroup.Item value="preview">
            <SegmentGroup.ItemHiddenInput />
            <SegmentGroup.ItemText display="inline-flex" alignItems="center" gap={1.5}>
              <Eye size={13} />
              {t("viewer.toolbar.preview")}
            </SegmentGroup.ItemText>
          </SegmentGroup.Item>
          <SegmentGroup.Item value="code">
            <SegmentGroup.ItemHiddenInput />
            <SegmentGroup.ItemText display="inline-flex" alignItems="center" gap={1.5}>
              <Code2 size={13} />
              {t("viewer.toolbar.code")}
            </SegmentGroup.ItemText>
          </SegmentGroup.Item>
        </SegmentGroup.Root>
      </Box>
    </Box>
  );
}
