import { create } from "zustand";
import {
  allowAssets,
  readMarkdownFile,
  unwatchFile,
  watchFile,
} from "../tauri/api";
import { dirnameOf, renderFull } from "../renderer/pipeline";
import { useRecent } from "./recent";

export interface Tab {
  id: string;
  /** Absolute file path; null for the home tab. */
  path: string | null;
  name: string;
  /** Raw markdown. */
  content: string;
  /** True when the watcher reported the file changed on disk but re-read failed. */
  diskChanged: boolean;
  /** Last scroll position, restored when the tab is re-activated / re-rendered. */
  scrollY: number;
  error: string | null;
}

interface TabsState {
  tabs: Tab[];
  activeId: string;
  /** Open a file (focuses its tab; an already-open file is re-read from disk). */
  openPath: (path: string, opts?: { background?: boolean }) => Promise<void>;
  /** Re-read the file backing a tab (file-changed event). */
  refreshPath: (path: string) => Promise<void>;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  setScroll: (id: string, y: number) => void;
}

let tabSeq = 1;
const nextId = () => `tab-${tabSeq++}`;

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** True when running inside the Tauri webview (false in a plain browser). */
const IN_TAURI = "__TAURI_INTERNALS__" in window;

/** Read a markdown file. In a plain browser (dev preview) fall back to
 *  fetching files under public/, since invoke/file IO don't exist there. */
async function loadContent(path: string): Promise<string> {
  if (IN_TAURI) {
    return readMarkdownFile(path);
  }
  const resp = await fetch(baseName(path));
  if (!resp.ok) {
    throw new Error(`浏览器预览模式只能打开 public/ 下的文件(如 sample.md):${path}`);
  }
  return resp.text();
}

export const HOME_TAB_ID = "home";

const HOME_TAB: Tab = {
  id: HOME_TAB_ID,
  path: null,
  name: "首页",
  content: "",
  diskChanged: false,
  scrollY: 0,
  error: null,
};

export const useTabs = create<TabsState>((set, get) => ({
  tabs: [HOME_TAB],
  activeId: HOME_TAB_ID,

  openPath: async (path, opts) => {
    const existing = get().tabs.find((t) => t.path !== null && t.path === path);
    if (existing) {
      if (opts?.background) return;
      // Re-read: the file may have changed since it was opened.
      set((s) => ({
        activeId: existing.id,
        tabs: s.tabs.map((t) =>
          t.id === existing.id ? { ...t, diskChanged: false, error: null } : t,
        ),
      }));
      try {
        const content = await loadContent(path);
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === existing.id ? { ...t, content, error: null } : t)),
        }));
      } catch (e) {
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === existing.id ? { ...t, error: String(e) } : t)),
        }));
      }
      return;
    }

    try {
      const content = await loadContent(path);
      const tab: Tab = {
        id: nextId(),
        path,
        name: baseName(path),
        content,
        diskChanged: false,
        scrollY: 0,
        error: null,
      };
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeId: opts?.background ? s.activeId : tab.id,
      }));
      useRecent.getState().remember(path);
      watchFile(path).catch((e) => console.error("watch_file failed:", e));
      // Local images become fetchable only through the Rust-side allowlist;
      // run the render once to collect what this document references.
      void Promise.resolve()
        .then(() => renderFull(content, dirnameOf(path)))
        .then((r) => allowAssets(path, r.assetPaths))
        .catch((e) => console.error("asset preflight failed:", e));
    } catch (e) {
      if (!opts?.background) {
        const tab: Tab = {
          id: nextId(),
          path,
          name: baseName(path),
          content: "",
          diskChanged: false,
          scrollY: 0,
          error: String(e),
        };
        set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
      }
      console.error("open failed:", path, e);
    }
  },

  refreshPath: async (path) => {
    const tab = get().tabs.find((t) => t.path === path);
    if (!tab) return;
    try {
      const content = await loadContent(path);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tab.id ? { ...t, content, diskChanged: false, error: null } : t,
        ),
      }));
    } catch {
      // The file may be mid-save or deleted; keep the old content and the
      // changed flag so the status bar can surface it.
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, diskChanged: true } : t)),
      }));
    }
  },

  closeTab: (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.path) {
      unwatchFile(tab.path).catch(() => {});
    }
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      if (tabs.length === 0) {
        return { tabs: [HOME_TAB], activeId: HOME_TAB_ID };
      }
      const activeId =
        s.activeId === id ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? tabs[0].id) : s.activeId;
      return { tabs, activeId };
    });
  },

  setActive: (id) => set({ activeId: id }),

  setScroll: (id, y) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, scrollY: y } : t)),
    })),
}));
