import { blockElementToMarkdown } from "./backconvert";

/**
 * Preview-edit → markdown source mapping (edit mode).
 *
 * The rendered article's top-level blocks carry `data-source-line` /
 * `data-source-end` (stamped by the renderer; 0-indexed, exclusive end, in
 * post-frontmatter coordinates). When the user edits the preview with
 * contentEditable, `collectPatches` turns MutationObserver records into
 * per-block line replacements; `applyLinePatches` splices them into the draft
 * while tracking the line drift those splices cause.
 *
 * Coordinates: everything here is in the renderer's coordinate space (after
 * frontmatter stripping). The caller adds `frontmatterLineOffset` when
 * splicing into the full-file draft.
 */

export interface LinePatch {
  /** 0-indexed first source line the block replaces (inclusive). */
  start: number;
  /** 0-indexed line after the block (exclusive). Equal to `start` for a pure insert. */
  end: number;
  /** Replacement markdown lines, no trailing blanks. */
  lines: string[];
  /** The DOM block the patch came from; the caller re-stamps its line attrs. */
  el: HTMLElement;
}

export interface CollectResult {
  /** True when some change could not be mapped to a block — the caller falls
   *  back to converting the whole article (backconvert.articleToMarkdown). */
  fallback: boolean;
  /** Sorted by `start` ascending. Empty when nothing changed. */
  patches: LinePatch[];
}

/** Markdown lines a rendered block converts to, without surrounding blanks. */
function blockLines(el: HTMLElement): string[] {
  return blockElementToMarkdown(el).replace(/^\n+|\n+$/g, "").split("\n");
}

/**
 * A patch covering `el`'s current DOM state. Used for programmatic edits
 * (image resize/replace) that bypass contentEditable mutations: callers add
 * the block via `markBlockDirty`-style flows and flush turns it into a patch.
 */
export function patchFromBlock(el: HTMLElement): LinePatch | null {
  const start = Number(el.dataset.sourceLine);
  const end = Number(el.dataset.sourceEnd);
  if (!Number.isInteger(start) || !Number.isInteger(end) || el.parentElement === null) return null;
  return { start, end, lines: blockLines(el), el };
}

function markedPrev(el: Element): HTMLElement | null {
  let cur = el.previousElementSibling;
  while (cur) {
    if (cur instanceof HTMLElement && cur.dataset.sourceLine !== undefined) return cur;
    cur = cur.previousElementSibling;
  }
  return null;
}

function markedNext(el: Element): HTMLElement | null {
  let cur = el.nextElementSibling;
  while (cur) {
    if (cur instanceof HTMLElement && cur.dataset.sourceLine !== undefined) return cur;
    cur = cur.nextElementSibling;
  }
  return null;
}

/**
 * Turn MutationObserver records into line patches. Deduplicates per source
 * range; a block touched ten times while typing becomes one replacement.
 */
export function collectPatches(article: HTMLElement, mutations: MutationRecord[]): CollectResult {
  const byRange = new Map<string, LinePatch>();
  let fallback = false;

  const push = (el: HTMLElement, start: number, end: number, lines: string[]) => {
    if (!Number.isInteger(start) || start < 0 || end < start) {
      fallback = true;
      return;
    }
    byRange.set(`${start}:${end}`, { start, end, lines, el });
  };

  // A change inside (or of) an existing marked block: replace its whole range.
  const markExisting = (node: Node | null): boolean => {
    const startEl = node instanceof Element ? node : node?.parentElement ?? null;
    if (!startEl || startEl === article) return false;
    const block = startEl.closest<HTMLElement>("[data-source-line]");
    if (!block || block.parentElement !== article) return false;
    push(block, Number(block.dataset.sourceLine), Number(block.dataset.sourceEnd), blockLines(block));
    return true;
  };

  // A new top-level block (Enter split, paste): anchor it between its marked
  // siblings. Stale markers copied along by the browser's clipboard are
  // removed so the element can't act as a bogus anchor later.
  const markAddedTopLevel = (el: HTMLElement): boolean => {
    const prev = markedPrev(el);
    const next = markedNext(el);
    let at: number | null = null;
    if (prev?.dataset.sourceEnd !== undefined) at = Number(prev.dataset.sourceEnd);
    else if (next?.dataset.sourceLine !== undefined) at = Number(next.dataset.sourceLine);
    delete el.dataset.sourceLine;
    delete el.dataset.sourceEnd;
    if (at === null) return false;
    push(el, at, at, blockLines(el));
    return true;
  };

  for (const m of mutations) {
    if (m.type === "characterData") {
      if (!markExisting(m.target)) fallback = true;
      continue;
    }
    // childList
    for (const added of Array.from(m.addedNodes)) {
      if (added.nodeType === Node.TEXT_NODE) {
        if (!markExisting(added)) fallback = true;
        continue;
      }
      if (!(added instanceof HTMLElement)) continue;
      if (added.parentElement === article) {
        if (!markAddedTopLevel(added)) fallback = true;
      } else if (!markExisting(added)) {
        fallback = true;
      }
    }
    for (const removed of Array.from(m.removedNodes)) {
      if (removed instanceof HTMLElement) {
        if (removed.dataset.sourceLine !== undefined && !removed.isConnected) {
          // A marked block deleted outright (e.g. paragraph selection + Del).
          push(removed, Number(removed.dataset.sourceLine), Number(removed.dataset.sourceEnd), []);
        }
        // Removed nodes that are still connected elsewhere were MOVED (drag);
        // the containing-block mutations cover the resulting text state.
      } else if (removed.nodeType === Node.TEXT_NODE) {
        if (!markExisting(m.target)) fallback = true;
      }
    }
  }

  const patches = [...byRange.values()].sort((a, b) => a.start - b.start);
  return { fallback, patches };
}

export interface RemappedBlock {
  el: HTMLElement;
  start: number;
  end: number;
}

export interface ApplyResult {
  /** Draft text with every patch spliced in. */
  text: string;
  /** Patched blocks with their new line ranges, in renderer coordinates
   *  (same space as the data-source-* attributes). */
  remapped: RemappedBlock[];
  /**
   * Cumulative line shift, in renderer coordinates: every block whose start
   * line is >= `from` moves by `delta`. Entries are in patch order; the last
   * one covering a line wins. The caller re-stamps all *other* marked blocks
   * with this.
   */
  shifts: Array<{ from: number; delta: number }>;
}

/**
 * Splice patches into `source`. Patches must be sorted by `start`; each is
 * interpreted in the ORIGINAL coordinate space and the drift is accumulated,
 * so a replace followed by an insert at the old block's end lands correctly.
 */
export function applyLinePatches(
  source: string,
  patches: LinePatch[],
  lineOffset: number,
): ApplyResult {
  const lines = source.split("\n");
  const remapped: RemappedBlock[] = [];
  const shifts: Array<{ from: number; delta: number }> = [];
  let delta = 0;

  for (const p of patches) {
    let fileEnd = p.end + lineOffset + delta;
    // 删除整个块时把紧随其后的空行一并吃掉,否则删除处会留下双倍空行。
    // 只在确认那一行确实是空行时才扩展——markdown 里块与块之间可以没有空行。
    const eaten = p.lines.length === 0 && lines[fileEnd] === "" ? 1 : 0;
    const fileStart = p.start + lineOffset + delta;
    if (eaten) fileEnd += 1;
    lines.splice(fileStart, fileEnd - fileStart, ...p.lines);
    remapped.push({ el: p.el, start: p.start + delta, end: p.start + delta + p.lines.length });
    delta += p.lines.length - (p.end - p.start) - eaten;
    shifts.push({ from: p.end, delta });
  }

  return { text: lines.join("\n"), remapped, shifts };
}

/** Shift for an original-coordinate line: the last shift that starts at or
 *  before it. Blocks before the first patch get 0. */
export function shiftForLine(shifts: Array<{ from: number; delta: number }>, line: number): number {
  let d = 0;
  for (const s of shifts) {
    if (s.from <= line) d = s.delta;
    else break;
  }
  return d;
}
