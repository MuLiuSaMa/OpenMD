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
  return instance;
}

/** Strip app-injected markers/UI, returning clean HTML for conversion. */
function cleanOuterHtml(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".code-copy-btn").forEach((n) => n.remove());
  for (const attr of ["data-source-line", "data-source-end", "data-raw-html", "contenteditable"]) {
    clone.removeAttribute(attr);
    clone.querySelectorAll(`[${attr}]`).forEach((n) => n.removeAttribute(attr));
  }
  return clone.outerHTML;
}

/**
 * Convert one rendered block element back to markdown. Blocks the renderer
 * passed through as raw HTML (`data-raw-html`, stamped on html_block output —
 * badge groups, `<div dir>` wrappers…) are emitted verbatim so hand-written
 * HTML survives the round trip; everything else goes through turndown.
 */
export function blockElementToMarkdown(el: HTMLElement): string {
  if (el.dataset.rawHtml !== undefined) return cleanOuterHtml(el);
  // 带对齐属性的段落/标题:markdown 表达不了对齐,整块转原始 HTML
  // (同 GitHub 的 `<p align="center">` 用法)。
  const align = el.getAttribute("align");
  if (
    align &&
    /^(?:left|center|right)$/i.test(align) &&
    /^(?:P|H[1-6]|DIV)$/.test(el.tagName)
  ) {
    return cleanOuterHtml(el);
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
