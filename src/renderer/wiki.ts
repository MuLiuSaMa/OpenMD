import type MarkdownIt from "markdown-it";

/**
 * Obsidian-style wiki syntax as a markdown-it inline rule.
 *
 * - `[[target]]` and `[[target|label]]` become in-app wiki links.
 * - `![[target]]` becomes an embed placeholder resolved after render; image
 *   targets render as images, other targets embed the referenced document or
 *   heading section.
 *
 * Resolution needs workspace/file IO, so the rule only emits stable
 * `data-wiki-*` attributes; `renderRichBlocks` performs the async resolution.
 */
export function wikiPlugin(md: MarkdownIt) {
  md.inline.ruler.before("link", "wiki", (state, silent) => {
    const src = state.src;
    const start = state.pos;
    const embed = src.startsWith("![[", start);
    const plain = !embed && src.startsWith("[[", start);
    if (!embed && !plain) return false;
    const contentStart = start + (embed ? 3 : 2);
    const close = src.indexOf("]]", contentStart);
    if (close === -1) return false;
    const inner = src.slice(contentStart, close);
    if (!inner.trim() || inner.includes("\n") || inner.includes("[[")) return false;

    if (!silent) {
      const pipe = inner.indexOf("|");
      const targetPart = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
      const hash = targetPart.indexOf("#");
      const target = (hash === -1 ? targetPart : targetPart.slice(0, hash)).trim();
      const section = hash === -1 ? "" : targetPart.slice(hash + 1).trim();
      if (!target) return false;
      // Without an explicit label, Obsidian shows the file name only — the
      // `#heading` part stays in the link target, not the visible text.
      const label = (pipe === -1 ? target : inner.slice(pipe + 1)).trim() || target;
      const token = state.push(embed ? "wiki_embed" : "wiki_link", "", 0);
      token.content = label;
      token.attrSet("data-wiki-target", target);
      if (section) token.attrSet("data-wiki-section", section);
    }
    state.pos = close + 2;
    return true;
  });

  md.renderer.rules.wiki_link = (tokens, idx) => {
    const token = tokens[idx];
    const target = md.utils.escapeHtml(token.attrGet("data-wiki-target") ?? "");
    const section = token.attrGet("data-wiki-section");
    const sectionAttr = section ? ` data-wiki-section="${md.utils.escapeHtml(section)}"` : "";
    return `<a class="wiki-link" href="#" data-wiki-target="${target}"${sectionAttr}>${md.utils.escapeHtml(
      token.content,
    )}</a>`;
  };
  md.renderer.rules.wiki_embed = (tokens, idx) => {
    const token = tokens[idx];
    const target = md.utils.escapeHtml(token.attrGet("data-wiki-target") ?? "");
    const section = token.attrGet("data-wiki-section");
    const sectionAttr = section ? ` data-wiki-section="${md.utils.escapeHtml(section)}"` : "";
    return `<span class="wiki-embed" data-wiki-target="${target}"${sectionAttr}>${md.utils.escapeHtml(
      token.content,
    )}</span>`;
  };
}
