import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface RecentFile {
  path: string;
  name: string;
  ts: number;
}

interface RecentState {
  files: RecentFile[];
  /** 用户手动移除过的路径:再次打开也不自动加回。点"清空"时一并重置。 */
  removed: string[];
  remember: (path: string) => void;
  remove: (path: string) => void;
  clear: () => void;
}

const MAX_RECENT = 10;
const MAX_REMOVED = 100;

export const useRecent = create<RecentState>()(
  persist(
    (set) => ({
      files: [],
      removed: [],
      // 手动删过的路径不再自动记录;想让它重新出现需点首页"清空"重置。
      remember: (path) =>
        set((s) => {
          if (s.removed.includes(path)) return s;
          const name = path.split(/[\\/]/).pop() ?? path;
          const rest = s.files.filter((f) => f.path !== path);
          return { files: [{ path, name, ts: Date.now() }, ...rest].slice(0, MAX_RECENT) };
        }),
      remove: (path) =>
        set((s) => ({
          files: s.files.filter((f) => f.path !== path),
          removed: [...s.removed.filter((p) => p !== path), path].slice(-MAX_REMOVED),
        })),
      clear: () => set({ files: [], removed: [] }),
    }),
    { name: "openmd-recent" },
  ),
);
