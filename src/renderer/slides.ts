import MarkdownIt from "markdown-it";

/** Bare parser used only to find real top-level thematic breaks. */
const parser = new MarkdownIt();

/**
 * Split Marp deck content (after frontmatter) into slides on top-level `---`.
 * `---` inside fenced code and setext heading underlines are not breaks.
 */
export function splitSlides(content: string): string[] {
  if (!content.trim()) return [];
  const lines = content.split("\n");
  const tokens = parser.parse(content, {});
  const breakLines: number[] = [];
  for (const token of tokens) {
    if (token.type === "hr" && token.level === 0 && token.map) {
      breakLines.push(token.map[0]);
    }
  }
  const slides: string[] = [];
  let start = 0;
  for (const brk of breakLines) {
    slides.push(lines.slice(start, brk).join("\n"));
    start = brk + 1;
  }
  slides.push(lines.slice(start).join("\n"));
  return slides.map((s) => s.trim()).filter(Boolean);
}
