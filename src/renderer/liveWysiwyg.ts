/**
 * MarkText 风格的实时所见即所得（Live WYSIWYG）辅助模块：
 * 1. 块级输入规则（# 标题、> 引用、- / 1. 列表、- [ ] 任务、--- 分割线、``` 代码块）
 * 2. 行内输入规则（**粗体**、*斜体*、~~删除线~~、`行内代码`、[链接](url)）
 * 3. 光标上下文语法显隐（data-md-active / data-md-inline-active）
 */

const INLINE_TAGS = new Set(["STRONG", "B", "EM", "I", "DEL", "S", "CODE", "A"]);
const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "LI", "PRE"]);

function placeCaret(node: Node, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function getCaretBlock(article: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const anchor = sel.anchorNode;
  if (!anchor || !article.contains(anchor)) return null;
  let el: HTMLElement | null =
    anchor instanceof HTMLElement ? anchor : anchor.parentElement;
  while (el && el !== article) {
    if (el.parentElement === article || BLOCK_TAGS.has(el.tagName)) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * 块级实时转换：在输入空格或回车后检查当前段落起始语法。
 * 返回被替换后需要标脏同步的新块元素（未触发则返回 null）。
 */
export function tryBlockInputRule(
  article: HTMLElement,
  trigger: "input" | "enter",
): HTMLElement | null {
  const block = getCaretBlock(article);
  if (!block) return null;
  if (block.closest("pre, code")) return null;
  if (block.tagName !== "P" && block.tagName !== "DIV") return null;

  const text = block.textContent ?? "";

  if (trigger === "enter") {
    const trimmed = text.trim();
    // ```lang + Enter → 代码块
    const fenceMatch = /^```([a-zA-Z0-9_-]*)$/.exec(trimmed);
    if (fenceMatch) {
      const lang = fenceMatch[1] ?? "";
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (lang) code.className = `language-${lang}`;
      code.textContent = "\n";
      pre.appendChild(code);
      block.replaceWith(pre);
      placeCaret(code.firstChild ?? code, 0);
      return pre;
    }
    // --- / *** / ___ + Enter → 分割线 + 新段落
    if (/^(---|___|\*\*\*)$/.test(trimmed)) {
      const hr = document.createElement("hr");
      const nextP = document.createElement("p");
      nextP.appendChild(document.createElement("br"));
      block.replaceWith(hr, nextP);
      placeCaret(nextP, 0);
      return nextP;
    }
    return null;
  }

  // 以下规则在输入空格后触发（检查行首前缀）
  // 1. 标题: # .. ###### + 空格
  const headingMatch = /^(#{1,6})\s(.*)$/s.exec(text);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const rest = headingMatch[2] ?? "";
    const h = document.createElement(`h${level}`);
    const tn = document.createTextNode(rest);
    h.appendChild(tn);
    block.replaceWith(h);
    placeCaret(tn, 0);
    return h;
  }

  // 2. 引用: > + 空格
  const quoteMatch = /^>\s(.*)$/s.exec(text);
  if (quoteMatch) {
    const rest = quoteMatch[1] ?? "";
    const bq = document.createElement("blockquote");
    const p = document.createElement("p");
    const tn = document.createTextNode(rest);
    p.appendChild(tn);
    bq.appendChild(p);
    block.replaceWith(bq);
    placeCaret(tn, 0);
    return bq;
  }

  // 3. 任务列表: - [ ] / - [x] + 空格
  const taskMatch = /^-\s\[([ xX])\]\s(.*)$/s.exec(text);
  if (taskMatch) {
    const checked = taskMatch[1].toLowerCase() === "x";
    const rest = taskMatch[2] ?? "";
    const ul = document.createElement("ul");
    ul.className = "contains-task-list";
    const li = document.createElement("li");
    li.className = "task-list-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked;
    const tn = document.createTextNode(` ${rest}`);
    li.append(cb, tn);
    ul.appendChild(li);
    block.replaceWith(ul);
    placeCaret(tn, tn.length);
    return ul;
  }

  // 4. 无序列表: - / * / + + 空格
  const ulMatch = /^[-*+]\s(.*)$/s.exec(text);
  if (ulMatch) {
    const rest = ulMatch[1] ?? "";
    const ul = document.createElement("ul");
    const li = document.createElement("li");
    const tn = document.createTextNode(rest);
    li.appendChild(tn);
    ul.appendChild(li);
    block.replaceWith(ul);
    placeCaret(tn, 0);
    return ul;
  }

  // 5. 有序列表: 1. + 空格
  const olMatch = /^(\d+)\.\s(.*)$/s.exec(text);
  if (olMatch) {
    const start = Number.parseInt(olMatch[1], 10);
    const rest = olMatch[2] ?? "";
    const ol = document.createElement("ol");
    if (start > 1) ol.start = start;
    const li = document.createElement("li");
    const tn = document.createTextNode(rest);
    li.appendChild(tn);
    ol.appendChild(li);
    block.replaceWith(ol);
    placeCaret(tn, 0);
    return ol;
  }

  return null;
}

interface InlineRule {
  re: RegExp;
  create: (m: RegExpExecArray) => HTMLElement;
}

const INLINE_RULES: InlineRule[] = [
  {
    re: /\*\*([^*\n]+)\*\*$/,
    create: (m) => {
      const el = document.createElement("strong");
      el.textContent = m[1];
      return el;
    },
  },
  {
    re: /__([^_\n]+)__$/,
    create: (m) => {
      const el = document.createElement("strong");
      el.textContent = m[1];
      return el;
    },
  },
  {
    re: /(?<!\*)\*([^*\n]+)\*$/,
    create: (m) => {
      const el = document.createElement("em");
      el.textContent = m[1];
      return el;
    },
  },
  {
    re: /~~([^~\n]+)~~$/,
    create: (m) => {
      const el = document.createElement("del");
      el.textContent = m[1];
      return el;
    },
  },
  {
    re: /`([^`\n]+)`$/,
    create: (m) => {
      const el = document.createElement("code");
      el.textContent = m[1];
      return el;
    },
  },
  {
    re: /\[([^\]\n]+)\]\(([^)\s]+)\)$/,
    create: (m) => {
      const el = document.createElement("a");
      el.href = m[2];
      el.textContent = m[1];
      return el;
    },
  },
];

/**
 * 行内实时转换：光标前刚闭合 **bold** / *italic* / ~~del~~ / `code` / [text](url)
 * 时立即渲染为对应行内元素，并将光标落在新元素之后的零宽文本节点上。
 */
export function tryInlineInputRule(article: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const anchor = sel.anchorNode;
  if (!(anchor instanceof Text) || !article.contains(anchor)) return null;
  if (anchor.parentElement?.closest("pre, code")) return null;

  const offset = sel.anchorOffset;
  const before = anchor.data.slice(0, offset);
  const after = anchor.data.slice(offset);

  for (const rule of INLINE_RULES) {
    const m = rule.re.exec(before);
    if (!m) continue;
    const prefix = before.slice(0, m.index);
    const created = rule.create(m);
    const parent = anchor.parentNode;
    if (!parent) continue;

    const frag = document.createDocumentFragment();
    if (prefix) frag.appendChild(document.createTextNode(prefix));
    frag.appendChild(created);
    const trailing = document.createTextNode(after.length > 0 ? after : "\u200B");
    frag.appendChild(trailing);

    parent.replaceChild(frag, anchor);
    placeCaret(trailing, after.length > 0 ? 0 : 1);

    const block =
      created.closest<HTMLElement>("[data-source-line]") ??
      created.closest<HTMLElement>("p, h1, h2, h3, h4, h5, h6, li, blockquote");
    return block;
  }

  return null;
}

/**
 * 同步光标所在块与行内元素的激活标记（MarkText 式显隐 Markdown 语法）。
 */
export function syncActiveSyntaxMarkers(article: HTMLElement): void {
  article
    .querySelectorAll("[data-md-active]")
    .forEach((el) => el.removeAttribute("data-md-active"));
  article
    .querySelectorAll("[data-md-inline-active]")
    .forEach((el) => el.removeAttribute("data-md-inline-active"));

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const node = sel.anchorNode;
  if (!node || !article.contains(node)) return;

  let cur: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement;
  let activeInline: HTMLElement | null = null;
  let activeBlock: HTMLElement | null = null;

  while (cur && cur !== article) {
    if (!activeInline && INLINE_TAGS.has(cur.tagName) && !cur.closest("pre")) {
      activeInline = cur;
    }
    if (
      !activeBlock &&
      (cur.parentElement === article || /^H[1-6]$/.test(cur.tagName))
    ) {
      activeBlock = cur;
    }
    cur = cur.parentElement;
  }

  if (activeBlock) activeBlock.setAttribute("data-md-active", "true");
  if (activeInline) activeInline.setAttribute("data-md-inline-active", "true");
}
