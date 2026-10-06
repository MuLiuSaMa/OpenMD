import { describe, expect, it } from "vitest";

import { renderFull, stripFrontmatter } from "./pipeline";
import { splitSlides } from "./slides";
import { sanitizeHtml } from "./sanitize";

const render = (md: string) => renderFull(md).html;

describe("core Markdown", () => {
  it("renders headings, emphasis, lists and tables", () => {
    const html = render(
      "# Title\n\n**bold** *italic* ~~strike~~\n\n- [x] done\n- [ ] todo\n\n| A | B |\n|---|---|\n| 1 | 2 |\n",
    );
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<s>strike</s>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<table");
  });

  it("renders footnotes", () => {
    const html = render("Text[^1]\n\n[^1]: Note body\n");
    expect(html).toContain("footnote-ref");
    expect(html).toContain("footnotes");
    expect(html).toContain("Note body");
  });

  it("renders definition lists, mark, sub, sup and ins", () => {
    const html = render("Term\n: Definition\n\n==mark== H~2~O x^2^ ++ins++\n");
    expect(html).toContain("<dl");
    expect(html).toContain("<dt>Term</dt>");
    expect(html).toContain("<dd>Definition</dd>");
    expect(html).toContain("<mark>mark</mark>");
    expect(html).toContain("<sub>2</sub>");
    expect(html).toContain("<sup>2</sup>");
    expect(html).toContain("<ins>ins</ins>");
  });

  it("renders abbreviations and emoji", () => {
    const html = render("*[HTML]: HyperText Markup Language\n\nHTML :smile:\n");
    expect(html).toContain("<abbr");
    expect(html).toContain("😄");
  });

  it("renders attributes and link attributes", () => {
    const html = render("# Heading {#custom .accent}\n\n[link](https://example.com)\n");
    expect(html).toContain('id="custom"');
    expect(html).toContain("accent");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders MultiMarkdown tables with captions", () => {
    const html = render(
      "| A | B ||\n|---|---|---|\n| 1 | 2 | 3 |\n[Caption]\n",
    );
    expect(html).toContain("<table");
    expect(html).toContain("<caption");
    expect(html).toContain("Caption");
  });

  it("renders implicit figures", () => {
    const html = render('![Alt](pic.png "Title")\n');
    expect(html).toContain("<figure");
    expect(html).toContain("<figcaption");
  });
});

describe("math", () => {
  it("renders inline and block KaTeX", () => {
    const html = render("Inline $E = mc^2$ math.\n\n$$\n\\int_0^1 x^2 dx\n$$\n");
    expect(html).toContain("katex");
    expect(html).toContain("katex-display");
  });
});

describe("alerts and containers", () => {
  it("renders GitHub alerts and Obsidian callouts", () => {
    const note = render("> [!NOTE]\n> Note body\n");
    expect(note).toContain("markdown-alert-note");
    const tip = render("> [!tip] Custom title\n> Tip body\n");
    expect(tip).toContain("markdown-alert-tip");
    expect(tip).toContain("Custom title");
    const bug = render("> [!bug]\n> Bug body\n");
    expect(bug).toContain("markdown-alert-bug");
  });

  it("passes fenced containers through", () => {
    const html = render("::: admonition\nBody\n:::\n");
    expect(html).toContain("admonition");
  });
});

describe("wiki syntax", () => {
  it("emits wiki link placeholders", () => {
    const html = render("See [[Target|Label]] and [[Other#Heading]].\n");
    expect(html).toContain('class="wiki-link"');
    expect(html).toContain('data-wiki-target="Target"');
    expect(html).toContain(">Label</a>");
    expect(html).toContain('data-wiki-section="Heading"');
  });

  it("emits wiki embed placeholders", () => {
    const html = render("![[Note#Section]]\n");
    expect(html).toContain('class="wiki-embed"');
    expect(html).toContain('data-wiki-target="Note"');
    expect(html).toContain('data-wiki-section="Section"');
  });
});

describe("frontmatter and slides", () => {
  it("parses nested YAML frontmatter", () => {
    const result = renderFull("---\nmarp: true\ntags:\n  - a\n  - b\n---\n# Slide\n");
    expect(result.isMarp).toBe(true);
    expect(result.frontmatter?.tags).toEqual(["a", "b"]);
  });

  it("splits slides only on top-level thematic breaks", () => {
    const content =
      "# One\n\n```yaml\n---\n```\n\n---\n\n# Two\n\nText\n---\nnot a break\n";
    const slides = splitSlides(content);
    expect(slides).toHaveLength(2);
    expect(slides[0]).toContain("# One");
    expect(slides[1]).toContain("# Two");
  });

  it("strips frontmatter for slide content", () => {
    expect(stripFrontmatter("---\nmarp: true\n---\n# Body\n")).toBe("# Body\n");
  });
});

describe("security", () => {
  it("removes script tags and event handlers", () => {
    const html = sanitizeHtml('<p onclick="alert(1)">ok</p><script>alert(1)</script>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).toContain("ok");
  });

  it("keeps rich HTML but strips srcdoc", () => {
    const html = sanitizeHtml(
      '<details open><summary>S</summary>body</details><iframe srcdoc="<script>x</script>"></iframe>',
    );
    expect(html).toContain("<details");
    expect(html).not.toContain("srcdoc");
    expect(html).toContain("sandbox");
  });
});
