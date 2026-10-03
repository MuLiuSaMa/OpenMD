import DOMPurify from "dompurify";

/**
 * Sanitize config for markdown output. Raw HTML is disabled in markdown-it
 * (`html: false`), so this is defense in depth for what the renderer itself
 * can emit. DOMPurify's defaults already allow `input` (task-list checkboxes),
 * `class`, `style`, `id` and `data-*` attributes; KaTeX/MathML tags join the
 * explicit allowlist in v1.1 when formula rendering lands.
 */
export function sanitizeHtml(raw: string): string {
  return DOMPurify.sanitize(raw, {
    FORBID_TAGS: ["style", "form"],
  });
}
