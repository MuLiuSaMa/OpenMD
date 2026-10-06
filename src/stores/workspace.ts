import { create } from "zustand";
import {
  listWorkspaceDir,
  unwatchWorkspace,
  watchWorkspace,
  type WorkspaceEntry,
} from "../tauri/api";

/** True when running inside the Tauri webview (false in a plain browser). */
const IN_TAURI = "__TAURI_INTERNALS__" in window;

const STORAGE_KEY = "openmd-workspace";

interface SavedWorkspace {
  root: string;
  expanded: string[];
}

function persist(root: string | null, expanded: Set<string>) {
  try {
    if (!root) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      const saved: SavedWorkspace = { root, expanded: Array.from(expanded) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    }
  } catch {
    /* localStorage 不可用(隐私模式等)时只影响跨启动记忆 */
  }
}

function restore(): SavedWorkspace | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedWorkspace;
    if (typeof saved?.root !== "string" || saved.root === "") return null;
    return saved;
  } catch {
    return null;
  }
}

interface WorkspaceState {
  /** 工作区根目录;null = 未打开。 */
  root: string | null;
  /** 展开的目录集合(含根)。 */
  expanded: Set<string>;
  /** 已加载目录的子项缓存(path → entries)。 */
  children: Map<string, WorkspaceEntry[]>;
  /** 打开文件夹为工作区(重复打开同一目录幂等;换目录会替换旧监听)。 */
  openFolder: (path: string) => Promise<void>;
  /** 关闭工作区:停止监听、清空树和持久化。 */
  close: () => Promise<void>;
  /** 展开/收起一个目录(子项懒加载)。 */
  toggleDir: (path: string) => Promise<void>;
  /** 首次进入文件 Tab / 根恢复后确保根已加载。 */
  ensureLoaded: (path: string) => Promise<void>;
  /** workspace-changed 事件入口:合并突发事件后重拉所有展开目录。 */
  refresh: (path: string) => void;
}

// workspace-changed 在一次外部保存里会连发多条,拖尾 150ms 合并成一轮重拉。
let refreshTimer: number | null = null;

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  root: null,
  expanded: new Set(),
  children: new Map(),

  openFolder: async (path) => {
    if (get().root === path) return;
    const prev = get().root;
    if (prev && IN_TAURI) {
      await unwatchWorkspace(prev).catch(() => {});
    }
    const expanded = new Set([path]);
    set({ root: path, expanded, children: new Map() });
    persist(path, expanded);
    if (IN_TAURI) {
      watchWorkspace(path).catch((e) => console.error("watch_workspace failed:", e));
    }
    await get().ensureLoaded(path);
  },

  close: async () => {
    const prev = get().root;
    if (prev && IN_TAURI) {
      await unwatchWorkspace(prev).catch(() => {});
    }
    set({ root: null, expanded: new Set(), children: new Map() });
    persist(null, new Set());
  },

  toggleDir: async (path) => {
    const expanded = new Set(get().expanded);
    if (expanded.has(path)) {
      expanded.delete(path);
      set({ expanded });
      persist(get().root, expanded);
      return;
    }
    expanded.add(path);
    set({ expanded });
    persist(get().root, expanded);
    await get().ensureLoaded(path);
  },

  ensureLoaded: async (path) => {
    if (!IN_TAURI || get().children.has(path)) return;
    try {
      const entries = await listWorkspaceDir(path);
      set((s) => ({ children: new Map(s.children).set(path, entries) }));
    } catch (e) {
      // 目录可能已被删除或无权限:树里保持收起,下一轮 refresh 会清掉
      console.error("list_workspace_dir failed:", path, e);
    }
  },

  refresh: (changedPath) => {
    void changedPath;
    if (refreshTimer !== null) return;
    refreshTimer = window.setTimeout(async () => {
      refreshTimer = null;
      const { root, expanded } = get();
      if (!root) return;
      for (const dir of expanded) {
        try {
          const entries = await listWorkspaceDir(dir);
          set((s) => ({ children: new Map(s.children).set(dir, entries) }));
        } catch {
          // 目录已消失:收起并清缓存,树自然少一项
          set((s) => {
            const next = new Set(s.expanded);
            next.delete(dir);
            const children = new Map(s.children);
            children.delete(dir);
            persist(s.root, next);
            return { expanded: next, children };
          });
        }
      }
    }, 150);
  },
}));

// 跨启动记忆:启动即恢复上次工作区(应用仍停留在首页,打开任意文档后
// 侧栏文件 Tab 立即有树)。浏览器预览环境无文件 IO,只恢复不加载。
const saved = restore();
if (saved) {
  const expanded = new Set([saved.root, ...saved.expanded]);
  useWorkspace.setState({ root: saved.root, expanded });
  persist(saved.root, expanded);
  if (IN_TAURI) {
    watchWorkspace(saved.root).catch(() => {});
    void useWorkspace.getState().ensureLoaded(saved.root);
  }
}
