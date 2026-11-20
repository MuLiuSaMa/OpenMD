import { create } from "zustand";

interface SplitState {
  splitOpen: boolean;
  diffOpen: boolean;
  /** 右侧分屏展示的 Tab ID；为 null 时自动选择其他已打开文档或同文档对照。 */
  splitTabId: string | null;
  toggleSplit: () => void;
  setSplitOpen: (open: boolean) => void;
  toggleDiff: () => void;
  setDiffOpen: (open: boolean) => void;
  setSplitTabId: (id: string | null) => void;
}

export const useSplit = create<SplitState>((set) => ({
  splitOpen: false,
  diffOpen: false,
  splitTabId: null,
  toggleSplit: () =>
    set((s) => ({
      splitOpen: !s.splitOpen,
      diffOpen: s.splitOpen ? false : s.diffOpen,
    })),
  setSplitOpen: (open) =>
    set((s) => ({
      splitOpen: open,
      diffOpen: open ? s.diffOpen : false,
    })),
  toggleDiff: () => set((s) => ({ diffOpen: !s.diffOpen })),
  setDiffOpen: (open) => set({ diffOpen: open }),
  setSplitTabId: (id) => set({ splitTabId: id }),
}));
