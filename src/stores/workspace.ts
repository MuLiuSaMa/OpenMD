import { create } from "zustand";
import {
  listWorkspaceDir,
  listWorkspaceFiles,
  unwatchWorkspace,
  watchWorkspace,
  type WorkspaceEntry,
} from "../tauri/api";
import { useSettings } from "./settings";

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
  /** 根目录下的文档总数(递归、有上限探测);null = 未知/尚未探测。 */
  fileCount: number | null;
  /**
   * 打开文件夹为工作区(重复打开同一目录不会重建监听;换目录会替换旧监听)。
   * 返回根目录下的文档清单摘要,调用方据此决定是否"立刻预览第一篇"
   * (主页/标题栏要,拖拽与快捷键的语境不一定)。
   */
  openFolder: (path: string) => Promise<{ count: number; firstDoc: string | null }>;
  /** 关闭工作区:停止监听、清空树和持久化。 */
  close: () => Promise<void>;
  /** 展开/收起一个目录(子项懒加载)。 */
  toggleDir: (path: string) => Promise<void>;
  /** 首次进入文件 Tab / 根恢复后确保根已加载。 */
  ensureLoaded: (path: string) => Promise<void>;
  /** workspace-changed 事件入口:合并突发事件后重拉所有展开目录。 */
  refresh: (path: string) => void;
}

/**
 * 递归列一遍工作区里的文档(有上限)。除了给头部计数,还用来决定"打开文件夹后
 * 直接进哪篇文档"。属于可失败的可选信息:老后端没有 `list_workspace_files`
 * 时回落空列表,绝不让它影响打开文件夹本身。
 */
async function listWorkspaceDocs(path: string): Promise<string[]> {
  try {
    const { files } = await listWorkspaceFiles(path);
    return files;
  } catch (e) {
    console.error("list_workspace_files failed:", path, e);
    return [];
  }
}

// workspace-changed 在一次外部保存里会连发多条,拖尾 150ms 合并成一轮重拉。
let refreshTimer: number | null = null;

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  root: null,
  expanded: new Set(),
  children: new Map(),
  fileCount: null,

  openFolder: async (path) => {
    // 启动时会恢复上次工作区；用户再次从主页选择同一目录时，不能把这次
    // 显式操作当成幂等 no-op，否则调用方拿不到 firstDoc，界面看起来毫无反应。
    if (get().root !== path) {
      const prev = get().root;
      if (prev && IN_TAURI) {
        await unwatchWorkspace(prev).catch(() => {});
      }
      const expanded = new Set([path]);
      set({ root: path, expanded, children: new Map(), fileCount: null });
      persist(path, expanded);
      if (IN_TAURI) {
        watchWorkspace(path).catch((e) => console.error("watch_workspace failed:", e));
      }
    }
    // 用户此刻就是在挑文件夹:侧栏切到「文件」页,并在打开文档后显示这棵树。
    useSettings.getState().setSidebarTab("files");
    await get().ensureLoaded(path);
    // 文档清单既当计数,又用来挑"打开文件夹后立刻预览"的那篇。
    const docs = await listWorkspaceDocs(path);
    // 期间用户可能已经换了别的目录(或关掉了工作区):这份结果作废。
    if (get().root !== path) return { count: docs.length, firstDoc: docs[0] ?? null };
    set({ fileCount: docs.length });
    // 有 Markdown 文档就打开第一篇(递归结果里目录树自然序的第一个),让调用方
    // 能把用户直接送进预览页;一篇都没有时停在侧栏空态,不制造空白预览页。
    return { count: docs.length, firstDoc: docs[0] ?? null };
  },

  close: async () => {
    const prev = get().root;
    if (prev && IN_TAURI) {
      await unwatchWorkspace(prev).catch(() => {});
    }
    set({ root: null, expanded: new Set(), children: new Map(), fileCount: null });
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
