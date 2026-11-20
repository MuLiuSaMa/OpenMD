// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  syncActiveSyntaxMarkers,
  tryBlockInputRule,
  tryInlineInputRule,
} from "./liveWysiwyg";

function setCaret(node: Node, offset: number) {
  const sel = window.getSelection()!;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

describe("liveWysiwyg", () => {
  it("converts heading prefix '# ' into h1", () => {
    const article = document.createElement("article");
    const p = document.createElement("p");
    p.textContent = "## Hello";
    article.appendChild(p);
    document.body.appendChild(article);
    setCaret(p.firstChild!, 3);

    const next = tryBlockInputRule(article, "input");
    expect(next?.tagName).toBe("H2");
    expect(next?.textContent).toBe("Hello");
    article.remove();
  });

  it("converts '> ' into blockquote and '- [x] ' into task list", () => {
    const article = document.createElement("article");
    const p1 = document.createElement("p");
    p1.textContent = "> Quote";
    const p2 = document.createElement("p");
    p2.textContent = "- [x] Done";
    article.append(p1, p2);
    document.body.appendChild(article);

    setCaret(p1.firstChild!, 2);
    const bq = tryBlockInputRule(article, "input");
    expect(bq?.tagName).toBe("BLOCKQUOTE");
    expect(bq?.textContent).toBe("Quote");

    setCaret(p2.firstChild!, 6);
    const ul = tryBlockInputRule(article, "input");
    expect(ul?.tagName).toBe("UL");
    expect(ul?.querySelector("input[type='checkbox']")?.hasAttribute("checked") || (ul?.querySelector("input[type='checkbox']") as HTMLInputElement)?.checked).toBe(true);
    article.remove();
  });

  it("converts '```ts' + Enter into fenced code block", () => {
    const article = document.createElement("article");
    const p = document.createElement("p");
    p.textContent = "```ts";
    article.appendChild(p);
    document.body.appendChild(article);
    setCaret(p.firstChild!, 5);

    const pre = tryBlockInputRule(article, "enter");
    expect(pre?.tagName).toBe("PRE");
    expect(pre?.querySelector("code")?.className).toBe("language-ts");
    article.remove();
  });

  it("converts inline **bold** and `code` live", () => {
    const article = document.createElement("article");
    const p = document.createElement("p");
    p.textContent = "hello **world**";
    article.appendChild(p);
    document.body.appendChild(article);
    setCaret(p.firstChild!, p.textContent.length);

    tryInlineInputRule(article);
    expect(p.querySelector("strong")?.textContent).toBe("world");
    article.remove();
  });

  it("reveals active block and inline markers on caret", () => {
    const article = document.createElement("article");
    const h1 = document.createElement("h1");
    const strong = document.createElement("strong");
    strong.textContent = "Title";
    h1.appendChild(strong);
    article.appendChild(h1);
    document.body.appendChild(article);

    setCaret(strong.firstChild!, 2);
    syncActiveSyntaxMarkers(article);
    expect(h1.getAttribute("data-md-active")).toBe("true");
    expect(strong.getAttribute("data-md-inline-active")).toBe("true");
    article.remove();
  });
});
