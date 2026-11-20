import { create } from "zustand";

interface SplitState {
  splitOpen: boolean;
  /** 右侧分屏展示的 Tab ID；为 null 时自动选择其他已打开文档或同文档对照。 */
  splitTabId: string | null;
  toggleSplit: () => void;
  setSplitOpen: (open: boolean) => void;
  setSplitTabId: (id: string | null) => void;
}

export const useSplit = create<SplitState>((set) => ({
  splitOpen: false,
  splitTabId: null,
  toggleSplit: () => set((s) => ({ splitOpen: !s.splitOpen })),
  setSplitOpen: (open) => set({ splitOpen: open }),
  setSplitTabId: (id) => set({ splitTabId: id }),
}));
