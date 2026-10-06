import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/**
 * HTML → Markdown conversion for edit mode's preview path.
 *
 * Preview edits happen on the rendered DOM; saving maps them back to markdown
 * source (see previewEdit.ts). Turndown is configured to round-trip what this
 * app's renderer produces: GitHub-flavored tables/task lists/strikethrough,
 * ATX headings, fenced code. Elements turndown has no rule for (inline badge
 * HTML, `<div dir>`, `<kbd>`…) are kept verbatim via `keep`.
 */

let service: TurndownService | null = null;

function makeService(): TurndownService {
  const instance = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
  });
  instance.use(gfm);
  // Keep everything we don't have a markdown representation for as raw HTML —
  // same philosophy as GitHub's renderer. (Whole blocks the renderer passed
  // through as raw HTML don't reach turndown at all — see blockElementToMarkdown.)
  // `font`/`center`/`big` are deprecated tags missing from the DOM typings.
  instance.keep([
    "span",
    "div",
    "sub",
    "sup",
    "kbd",
    "mark",
    "details",
    "summary",
    "small",
    "u",
    "font",
    "center",
    "big",
  ] as unknown as TurndownService.Filter);
  // Local images carry the markdown-relative path in `data-original-src`
  // (stamped by resolveRelativeImages); prefer it over the asset-protocol URL
  // the webview actually loads. A width attribute can't be expressed in
  // markdown syntax, so sized images round-trip as raw HTML (GitHub does the
  // same); unsized ones stay plain markdown images.
  instance.addRule("originalImageSrc", {
    filter: (node) =>
      node.nodeName === "IMG" && node.getAttribute("data-original-src") !== null,
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const alt = (el.getAttribute("alt") ?? "").replace(/[\[\]]/g, "\\$&");
      const src = el.getAttribute("data-original-src") ?? "";
      const title = el.getAttribute("title");
      const width = el.getAttribute("width");
      if (width && /^\d+$/.test(width)) {
        const esc = (v: string) => v.replace(/"/g, "&quot;");
        const titlePart = title ? ` title="${esc(title)}"` : "";
        return `<img src="${esc(src)}" alt="${esc(alt)}" width="${width}"${titlePart}>`;
      }
      const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
      return `![${alt}](${src}${titlePart})`;
    },
  });
  // Math: KaTeX keeps the original TeX in a MathML annotation node.
  instance.addRule("katex", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      (node as HTMLElement).classList.contains("katex"),
    replacement: (_content, node) => {
      const annotation = node.querySelector?.('annotation[encoding="application/x-tex"]');
      const tex = annotation?.textContent?.trim() ?? node.textContent?.trim() ?? "";
      return (node as HTMLElement).classList.contains("katex-display")
        ? `\n\n$$\n${tex}\n$$\n\n`
        : `$${tex}$`;
    },
  });
  // GitHub/Obsidian alerts and callouts.
  instance.addRule("alert", {
    filter: (node) =>
      node.nodeName === "DIV" &&
      (node as HTMLElement).classList.contains("markdown-alert"),
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const marker =
        el.className.match(/markdown-alert-([\w-]+)/)?.[1]?.toUpperCase() ?? "NOTE";
      const title = el.querySelector(".markdown-alert-title")?.textContent?.trim();
      const body = Array.from(el.children)
        .filter((child) => !child.classList.contains("markdown-alert-title"))
        .map((child) => markdownFromHtml(child.outerHTML).trim())
        .filter(Boolean)
        .join("\n");
      return `\n\n> [!${marker}]${title && title.toUpperCase() !== marker ? ` ${title}` : ""}\n${body
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    },
  });
  instance.addRule("mark", {
    filter: "mark",
    replacement: (content) => `==${content}==`,
  });
  instance.addRule("sub", {
    filter: "sub",
    replacement: (content) => `~${content}~`,
  });
  instance.addRule("sup", {
    filter: "sup",
    replacement: (content) => `^${content}^`,
  });
  instance.addRule("ins", {
    filter: "ins",
    replacement: (content) => `++${content}++`,
  });
  instance.addRule("abbr", {
    filter: "abbr",
    replacement: (content, node) => {
      const title = (node as HTMLElement).getAttribute("title") ?? "";
      return title ? `*[${content}]: ${title}` : content;
    },
  });
  instance.addRule("deflist", {
    filter: (node) => node.nodeName === "DL",
    replacement: (_content, node) => {
      const parts: string[] = [];
      for (const child of Array.from((node as HTMLElement).children)) {
        const text = markdownFromHtml(child.innerHTML).trim();
        parts.push(child.nodeName === "DT" ? text : `: ${text}`);
      }
      return `\n\n${parts.join("\n")}\n\n`;
    },
  });
  return instance;
}

/** Clone a block with the app-injected markers/UI stripped. */
function cloneCleaned(el: HTMLElement): HTMLElement {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".code-copy-btn").forEach((n) => n.remove());
  for (const attr of ["data-source-line", "data-source-end", "data-raw-html", "contenteditable"]) {
    clone.removeAttribute(attr);
    clone.querySelectorAll(`[${attr}]`).forEach((n) => n.removeAttribute(attr));
  }
  return clone;
}

/**
 * Clean HTML for the turndown path. `data-original-src` is deliberately kept —
 * the image rule below needs it to emit the markdown-relative path.
 */
function cleanOuterHtml(el: HTMLElement): string {
  return cloneCleaned(el).outerHTML;
}

/**
 * Clean HTML for the raw-HTML path (aligned blocks, hand-written HTML). These
 * never reach turndown, so the webview's asset-protocol `src` has to be swapped
 * back to the markdown-relative path here. Without this, a `<p align="center">`
 * wrapping a screenshot would bake `http://asset.localhost/…` into the source —
 * which is how a README's image links end up pointing at one machine's disk.
 */
function rawHtmlToMarkdown(el: HTMLElement): string {
  const clone = cloneCleaned(el);
  clone.querySelectorAll("img[data-original-src]").forEach((img) => {
    const original = img.getAttribute("data-original-src");
    if (original) img.setAttribute("src", original);
    img.removeAttribute("data-original-src");
  });
  return clone.outerHTML;
}

/**
 * Convert one rendered block element back to markdown. Blocks the renderer
 * passed through as raw HTML (`data-raw-html`, stamped on html_block output —
 * badge groups, `<div dir>` wrappers…) are emitted as HTML so hand-written
 * markup survives the round trip; everything else goes through turndown.
 */
export function blockElementToMarkdown(el: HTMLElement): string {
  if (el.classList.contains("md-rich")) {
    const kind = el.getAttribute("data-rich-kind") ?? "text";
    const source = (el.getAttribute("data-rich-src") ?? "").replace(/\r?\n$/, "");
    return `\`\`\`${kind}\n${source}\n\`\`\``;
  }
  // 预览编辑把 Mermaid 代码块渲染成 SVG 后,回写时恢复原始围栏代码块。
  if (el.classList.contains("md-mermaid")) {
    const source = (el.getAttribute("data-mermaid-src") ?? "").replace(/\r?\n$/, "");
    return `\`\`\`mermaid\n${source}\n\`\`\``;
  }
  if (el.dataset.rawHtml !== undefined) return rawHtmlToMarkdown(el);
  // 带对齐属性的段落/标题:markdown 表达不了对齐,整块转原始 HTML
  // (同 GitHub 的 `<p align="center">` 用法)。
  const align = el.getAttribute("align");
  if (
    align &&
    /^(?:left|center|right)$/i.test(align) &&
    /^(?:P|H[1-6]|DIV)$/.test(el.tagName)
  ) {
    return rawHtmlToMarkdown(el);
  }
  return markdownFromHtml(cleanOuterHtml(el));
}

/**
 * Convert the whole rendered article back to markdown (fallback path):
 * per-block conversion joined with blank lines, so raw-HTML blocks keep the
 * same fidelity here as in the per-block path.
 */
export function articleToMarkdown(article: HTMLElement): string {
  const parts: string[] = [];
  for (const child of Array.from(article.children)) {
    if (!(child instanceof HTMLElement)) continue;
    parts.push(blockElementToMarkdown(child).replace(/^\n+|\n+$/g, ""));
  }
  return parts.filter((p) => p.length > 0).join("\n\n");
}

/** Convert one rendered block element back to markdown (turndown path). */
export function blockToMarkdown(el: HTMLElement): string {
  return blockElementToMarkdown(el);
}

/** HTML string → markdown. The DOM entry points above funnel through here. */
export function markdownFromHtml(html: string): string {
  if (!service) service = makeService();
  return service.turndown(html);
}
