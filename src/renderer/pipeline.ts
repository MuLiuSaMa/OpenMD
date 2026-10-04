import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import anchor from "markdown-it-anchor";
import { convertFileSrc } from "@tauri-apps/api/core";
import hljs from "./hljs";
import { sanitizeHtml } from "./sanitize";

export interface RenderResult {
  html: string;
  frontmatter: Record<string, unknown> | null;
  wordCount: number;
  /**
   * Absolute on-disk paths of every local image the document references,
   * after resolution against `baseDir`. The caller hands these to the
   * `allow_assets` command, which is the only way a file becomes fetchable
   * by the webview's asset protocol.
   */
  assetPaths: string[];
}

/** Matches a leading `---\n…\n---\n` frontmatter block. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/**
 * Drop a byte-order mark at offset 0.
 *
 * U+FEFF there is an encoding *signature*, not document content — Notepad's
 * "UTF-8 with BOM" and many Windows tools prepend it. markdown-it would see
 * `\uFEFF# Heading`, a line that no longer begins with `#`, and every leading
 * block construct degrades to a paragraph.
 *
 * Only offset 0 is stripped; anywhere else U+FEFF is a legitimate zero-width
 * no-break space that belongs to the document.
 */
function stripBom(markdown: string): string {
  return markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown;
}

/** Return the markdown body with any leading frontmatter block removed. */
export function stripFrontmatter(markdown: string): string {
  const source = stripBom(markdown);
  const m = source.match(FRONTMATTER_RE);
  return m ? m[2] : source;
}

/**
 * Lines the leading frontmatter block occupies (0 when absent).
 *
 * `data-source-line` coordinates are relative to the markdown body AFTER the
 * frontmatter is stripped, while the editor's draft covers the whole file —
 * line patches from preview edits must add this offset before splicing.
 */
export function frontmatterLineOffset(markdown: string): number {
  const m = stripBom(markdown).match(FRONTMATTER_RE);
  return m ? m[1].split("\n").length + 2 : 0;
}

let md: MarkdownIt | null = null;

/**
 * Stamp top-level block elements with `data-source-line="N"` (0-indexed line
 * in the source markdown) plus `data-source-end="M"` (exclusive). Used for
 * scroll-position restore, view ↔ raw scroll sync, and — in edit mode — for
 * mapping a preview edit back to the source lines it must replace.
 *
 * Two stamping paths: regular block tokens (`paragraph_open`, …) go through
 * `attrSet` because their renderer merges token attrs into the element. Raw
 * HTML blocks render `token.content` verbatim — attrs are ignored there — so
 * the attributes are injected into the opening tag string instead. This is
 * what makes badge blocks (`<p align="center">…</p>`) addressable.
 */
function addSourceLinePlugin(mdInstance: MarkdownIt) {
  mdInstance.core.ruler.push("source-line", (state) => {
    for (const token of state.tokens) {
      if (!token.map || token.level !== 0) continue;
      if (token.type.endsWith("_open")) {
        token.attrSet("data-source-line", String(token.map[0]));
        token.attrSet("data-source-end", String(token.map[1]));
      } else if (token.type === "html_block" && !/data-source-line=/.test(token.content)) {
        // Right after the tag name — safe even when attributes contain `>`
        // inside quoted values. Close tags (`</p>`) and comments don't match
        // and stay untouched. `data-raw-html` marks the block so edit-mode
        // conversion saves it back as verbatim HTML instead of degrading it
        // to markdown syntax (badge blocks keep their align/style attrs).
        token.content = token.content.replace(
          /^<([a-zA-Z][^\s/>]*)/,
          `<$1 data-source-line="${token.map[0]}" data-source-end="${token.map[1]}" data-raw-html="1"`,
        );
      }
    }
  });
}

// Text-bearing blocks that should auto-detect direction. Code is deliberately
// excluded — it must stay LTR regardless of surrounding text.
const DIR_AUTO_BLOCKS = new Set([
  "paragraph_open",
  "heading_open",
  "blockquote_open",
  "list_item_open",
  "td_open",
  "th_open",
]);

// A GitHub-style wrapper: a block whose whole content is `<div dir="rtl">` /
// `<div dir="ltr">` (any other attributes tolerated and ignored) or `</div>`.
// With raw HTML enabled these arrive as real html_block tokens; anything else
// is left untouched.
const DIR_WRAPPER_MAX_LEN = 256;
const DIR_WRAPPER_TAG = /^<div(?:\s[^>]*)?>$/i;
const DIR_WRAPPER_VALUE = /(?:^|\s)dir\s*=\s*["']?(rtl|ltr)["']?(?=\s|>|$)/i;
const DIR_WRAPPER_CLOSE = /^<\/div\s*>$/i;

function wrapperDirection(content: string): "rtl" | "ltr" | null {
  if (content.length > DIR_WRAPPER_MAX_LEN || !DIR_WRAPPER_TAG.test(content)) return null;
  const m = content.slice(4, -1).match(DIR_WRAPPER_VALUE);
  return m ? (m[1].toLowerCase() as "rtl" | "ltr") : null;
}

/**
 * Give each text-bearing block a direction. By default `dir="auto"`: the
 * block picks its own base direction from its first strong-directional
 * character, so RTL paragraphs right-align on their own. GitHub-style
 * `<div dir="rtl">` wrappers are honoured: the html_block tokens stay in the
 * output (so the div really wraps its content in the DOM) and every block
 * between the open and close tags gets that explicit direction.
 */
function addDirPlugin(mdInstance: MarkdownIt) {
  mdInstance.core.ruler.push("dir", (state) => {
    const tokens = state.tokens;
    const kept: typeof tokens = [];
    const stack: string[] = [];
    for (const token of tokens) {
      if (token.type === "html_block") {
        const content = token.content.trim();
        const open = wrapperDirection(content);
        if (open) {
          stack.push(open);
          kept.push(token);
          continue;
        }
        if (
          stack.length > 0 &&
          content.length <= DIR_WRAPPER_MAX_LEN &&
          DIR_WRAPPER_CLOSE.test(content)
        ) {
          stack.pop();
          kept.push(token);
          continue;
        }
      }
      if (DIR_AUTO_BLOCKS.has(token.type)) {
        token.attrSet("dir", stack.length > 0 ? stack[stack.length - 1] : "auto");
      }
      kept.push(token);
    }
    state.tokens = kept;
  });
}

function makeMarkdownIt(): MarkdownIt {
  const instance = new MarkdownIt({
    // Raw HTML (badges, <kbd>, <details>, <div dir>…) is rendered. Everything
    // still passes through DOMPurify in sanitizeHtml before it reaches the DOM.
    html: true,
    linkify: true,
    typographer: true,
    highlight: (str, lang) => {
      if (lang && lang !== "mermaid" && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(str, { language: lang }).value;
        } catch {
          /* fall through to auto */
        }
      }
      if (lang) {
        // Unknown explicit language: better plain than a wrong guess.
        return "";
      }
      try {
        return hljs.highlightAuto(str).value;
      } catch {
        return "";
      }
    },
  });

  instance.use(taskLists, { enabled: false, label: true });
  instance.use(anchor, {
    permalink: false,
    // Unicode-aware: keep CJK and other letters so 中文标题 get usable ids
    // (the GitHub-style ASCII slugify reduces 标题一 to an empty string,
    // which breaks TOC navigation and anchor links for Chinese documents).
    slugify: (s: string) =>
      s
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s+/g, "-"),
  });
  addSourceLinePlugin(instance);
  addDirPlugin(instance);
  return instance;
}

/** Simple `key: value` frontmatter parser (strings and string arrays only). */
function parseFrontmatter(block: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  block.split("\n").forEach((line) => {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let val: unknown = line.slice(colonIdx + 1).trim();
      if (typeof val === "string" && val.startsWith("[") && val.endsWith("]")) {
        val = val
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim());
      }
      if (
        typeof val === "string" &&
        ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      ) {
        val = val.slice(1, -1);
      }
      if (key) data[key] = val;
    }
  });
  return data;
}

export function renderFull(markdown: string, baseDir?: string): RenderResult {
  if (!md) {
    md = makeMarkdownIt();
  }

  const source = stripBom(markdown);

  let content = source;
  let frontmatter: Record<string, unknown> | null = null;
  const fmMatch = source.match(FRONTMATTER_RE);
  if (fmMatch) {
    try {
      const data = parseFrontmatter(fmMatch[1]);
      if (Object.keys(data).length > 0) {
        frontmatter = data;
        content = fmMatch[2];
      }
    } catch {
      // Not valid frontmatter — render as-is.
    }
  }

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  const raw = md.render(content);
  let html = sanitizeHtml(raw);

  const assetPaths: string[] = [];
  if (baseDir) {
    html = resolveRelativeImages(html, baseDir, assetPaths);
  }

  return { html, frontmatter, wordCount, assetPaths };
}

export function render(markdown: string, baseDir?: string): string {
  return renderFull(markdown, baseDir).html;
}

function resolveRelativeImages(html: string, baseDir: string, collected: string[]): string {
  return html
    .replace(
      /(<img\s[^>]*?\bsrc=")(?!https?:\/\/|data:|blob:|asset:|file:)([^"]+)(")/gi,
      (_match, before, src, after) => {
        try {
          const imagePath = resolveLocalPath(src, baseDir);
          collected.push(imagePath);
          // `data-original-src` keeps the markdown-relative path on the DOM so
          // preview-edit → markdown conversion can emit it back instead of the
          // asset-protocol URL. `src` is re-emitted verbatim: it is already a
          // well-formed attribute value (markdown-it escaped it).
          return `${before}${convertFileSrc(imagePath)}" data-original-src="${src}${after}`;
        } catch {
          return `${before}${src}${after}`;
        }
      },
    )
    .replace(
      /(<(?:img|source)\s[^>]*?\bsrcset=")([^"]+)(")/gi,
      (_match, before, srcset, after) =>
        `${before}${resolveSrcset(srcset, baseDir, collected)}${after}`,
    );
}

function resolveSrcset(srcset: string, baseDir: string, collected: string[]): string {
  return srcset
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) return trimmed;

      const [src, ...descriptor] = trimmed.split(/\s+/);
      if (isExternalSrc(src)) return trimmed;

      try {
        const imagePath = resolveLocalPath(src, baseDir);
        const converted = convertFileSrc(imagePath);
        collected.push(imagePath);
        return [converted, ...descriptor].join(" ");
      } catch {
        return trimmed;
      }
    })
    .join(", ");
}

function isExternalSrc(src: string): boolean {
  return /^(?:https?:\/\/|data:|blob:|asset:|file:)/i.test(src);
}

/**
 * Resolve a local path (image src or markdown link href) against `baseDir`.
 * Decodes `%20`, passes absolute/Windows paths through, and normalizes `./`,
 * `../`, and mixed separators. Shared by image rendering and local-file links
 * so there's a single resolution implementation.
 */
export function resolveLocalPath(src: string, baseDir: string): string {
  const decodedSrc = decodePath(src);
  if (isAbsolutePath(decodedSrc)) return decodedSrc;
  return normalizePath(`${baseDir}/${decodedSrc}`);
}

function decodePath(src: string): string {
  try {
    return decodeURI(src);
  } catch {
    return src;
  }
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

function normalizePath(path: string): string {
  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\");
  const separator = isWindowsPath ? "\\" : "/";
  const normalized = path.replace(/[\\/]+/g, separator);
  const prefix = normalized.startsWith(separator) ? separator : "";
  const parts = normalized.split(separator);
  const stack: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === ".." && stack.length > 0 && stack[stack.length - 1] !== "..") {
      stack.pop();
    } else if (part !== ".." || !prefix) {
      stack.push(part);
    }
  }

  return `${prefix}${stack.join(separator)}`;
}

/** Directory part of an absolute path (no trailing separator). */
export function dirnameOf(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return idx > 0 ? filePath.slice(0, idx) : filePath;
}
