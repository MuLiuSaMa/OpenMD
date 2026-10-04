import { create } from "zustand";
import {
  allowAssets,
  readMarkdownFile,
  unwatchFile,
  watchFile,
  writeMarkdownFile,
} from "../tauri/api";
import { ask } from "@tauri-apps/plugin-dialog";
import { dirnameOf, renderFull } from "../renderer/pipeline";
import { useConfirm } from "./confirm";
import { useRecent } from "./recent";

export interface Tab {
  id: string;
  /** Absolute file path; null for the home tab. */
  path: string | null;
  name: string;
  /** Raw markdown. */
  content: string;
  /**
   * Edit-mode buffer; null when the tab has no edit session. Typing in the
   * code view and preview-edit patches both land here; `dirty` is derived
   * (`draft !== null && draft !== content`). Survives view/tab switches so an
   * unsaved edit is never silently dropped.
   */
  draft: string | null;
  /** Timestamp of the last successful save — the watcher suppresses reloads
   *  within a short window after it, so our own write doesn't flash the tab. */
  lastSavedAt: number;
  /** True when the watcher reported the file changed on disk but re-read failed. */
  diskChanged: boolean;
  /** Last scroll position, restored when the tab is re-activated / re-rendered. */
  scrollY: number;
  error: string | null;
}

/** Tab has unsaved edits. */
export function isDirty(tab: Tab): boolean {
  return tab.draft !== null && tab.draft !== tab.content;
}

interface TabsState {
  tabs: Tab[];
  activeId: string;
  /** Open a file (focuses its tab; an already-open file is re-read from disk). */
  openPath: (path: string, opts?: { background?: boolean }) => Promise<void>;
  /** Re-read the file backing a tab (file-changed event). */
  refreshPath: (path: string) => Promise<void>;
  /** Code-view typing: set the edit buffer (initialized from content). */
  updateDraft: (id: string, value: string) => void;
  /** Preview-edit path: store an already-spliced draft (see previewEdit.ts). */
  setDraft: (id: string, value: string) => void;
  /** Write the edit buffer to disk (Ctrl+S / save button). */
  saveTab: (id: string) => Promise<void>;
  /** Close with an unsaved-changes confirmation when the tab is dirty. */
  requestCloseTab: (id: string) => Promise<void>;
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
  draft: null,
  lastSavedAt: 0,
  diskChanged: false,
  scrollY: 0,
  error: null,
};

/** Native confirm dialog; window.confirm in the plain-browser dev mode. */
async function confirmDialog(message: string): Promise<boolean> {
  if (!IN_TAURI) return window.confirm(message);
  return ask(message, { title: "OpenMD", kind: "warning" });
}

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
        // 重新打开可能读到引用新图片的内容:同样先入白名单再更新。
        try {
          const r = renderFull(content, dirnameOf(path));
          await allowAssets(path, r.assetPaths);
        } catch (e) {
          console.error("asset preflight failed:", e);
        }
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
      // 本地图片只有进入 Rust 侧 asset 白名单才能被 webview 拉取,而首帧的
      // <img> 请求与白名单写入存在竞态:请求先到会被拒且 <img> 不会重试
      // (切视图重建 DOM 才恢复)。所以必须在落地 tab 状态(触发渲染)之前
      // 完成白名单更新。
      try {
        const r = renderFull(content, dirnameOf(path));
        await allowAssets(path, r.assetPaths);
      } catch (e) {
        console.error("asset preflight failed:", e);
      }
      const tab: Tab = {
        id: nextId(),
        path,
        name: baseName(path),
        content,
        draft: null,
        lastSavedAt: 0,
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
    } catch (e) {
      if (!opts?.background) {
        const tab: Tab = {
          id: nextId(),
          path,
          name: baseName(path),
          content: "",
          draft: null,
          lastSavedAt: 0,
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
      // 外部修改可能引入新图片;先入白名单再更新内容,理由同 openPath。
      try {
        const r = renderFull(content, dirnameOf(path));
        await allowAssets(path, r.assetPaths);
      } catch (e) {
        console.error("asset preflight failed:", e);
      }
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tab.id
            ? {
                ...t,
                content,
                error: null,
                // The edit buffer survives external reloads so in-progress
                // edits are never dropped; when the disk content now differs
                // from what the user started from, surface it — saving will
                // then ask before overwriting the external change.
                diskChanged: t.draft !== null && t.draft !== content,
              }
            : t,
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

  updateDraft: (id, value) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, draft: value } : t)),
    })),

  setDraft: (id, value) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, draft: value } : t)),
    })),

  saveTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab?.path) return;
    const edited = tab.draft ?? tab.content;
    if (edited === tab.content) return;
    if (tab.diskChanged) {
      const ok = await confirmDialog(
        "文件已在磁盘上被修改。仍要用编辑内容覆盖吗?",
      );
      if (!ok) return;
    }
    // Textareas hand the value back with LF endings; write the file back in
    // the line-ending style it already uses so saving doesn't rewrite every
    // line of a CRLF document.
    const text = tab.content.includes("\r\n")
      ? edited.replace(/\r?\n/g, "\r\n")
      : edited.replace(/\r?\n/g, "\n");
    try {
      if (IN_TAURI) {
        await writeMarkdownFile(tab.path, text);
      } else {
        console.warn("浏览器预览模式不支持写盘,内容未保存");
      }
      // Newly referenced local images need the asset allowlist; the watcher
      // suppression window covers our own write (see App.tsx). Awaiting it
      // keeps the post-save re-render from racing the allowlist (see openPath).
      const path = tab.path;
      try {
        const r = renderFull(text, dirnameOf(path));
        await allowAssets(path, r.assetPaths);
      } catch (e) {
        console.error("asset preflight failed:", e);
      }
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === id
            ? { ...t, content: text, draft: null, lastSavedAt: Date.now(), diskChanged: false }
            : t,
        ),
      }));
    } catch (e) {
      // Keep the tab dirty; the edit buffer is untouched, saving can retry.
      console.error("save failed:", e);
    }
  },

  requestCloseTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    if (isDirty(tab)) {
      // 自定义弹窗(保存 / 不保存),替代系统原生 MessageBox。
      const choice = await useConfirm.getState().requestUnsaved(tab.name);
      if (choice === "cancel") return;
      if (choice === "save") {
        await get().saveTab(id);
        // 保存失败(如磁盘冲突被取消)时标签仍是脏的,保持打开。
        const after = get().tabs.find((t) => t.id === id);
        if (after && isDirty(after)) return;
      }
    }
    get().closeTab(id);
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
