import DOMPurify from "dompurify";

/**
 * Sanitize config for markdown output. Raw HTML is enabled in markdown-it, so
 * this is the primary gate: DOMPurify's defaults allow `p`/`a`/`img` and
 * `align`/`href`/`src` (badges, <kbd>, <details>, task-list `input`, `class`,
 * `style`, `id`, `data-*`) and strip script, event handlers and unsafe
 * protocols. iframes/objects are dropped outright — the CSP frame-src would
 * only turn them into blank boxes.
 */
export function sanitizeHtml(raw: string): string {
  return DOMPurify.sanitize(raw, {
    FORBID_TAGS: ["style", "form", "iframe", "object", "embed"],
  });
}
