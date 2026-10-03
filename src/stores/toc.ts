import { create } from "zustand";

export interface TocEntry {
  id: string;
  text: string;
  level: number;
}

interface TocState {
  entries: TocEntry[];
  activeId: string | null;
  setEntries: (entries: TocEntry[]) => void;
  setActive: (id: string | null) => void;
}

export const useToc = create<TocState>((set) => ({
  entries: [],
  activeId: null,
  setEntries: (entries) => set({ entries }),
  setActive: (id) => set({ activeId: id }),
}));

/** Extract h1–h6 with anchor ids from the rendered container. */
export function extractToc(container: HTMLElement): TocEntry[] {
  const headings = container.querySelectorAll("h1, h2, h3, h4, h5, h6");
  const entries: TocEntry[] = [];

  headings.forEach((el) => {
    const id = el.id;
    if (!id) return;
    const level = parseInt(el.tagName[1], 10);
    const text = el.textContent?.trim() ?? "";
    if (text) {
      entries.push({ id, text, level });
    }
  });

  return entries;
}

let observerPaused = false;

/** Navigate via TOC click: pause the observer so the smooth scroll doesn't
 *  fight it, then resume once the scroll has settled. */
export function setActiveHeading(id: string): void {
  observerPaused = true;
  useToc.getState().setActive(id);
  setTimeout(() => {
    observerPaused = false;
  }, 800);
}

export function isObserverPaused(): boolean {
  return observerPaused;
}
