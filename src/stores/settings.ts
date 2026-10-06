import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ViewMode = "preview" | "code";
/** 关闭窗口行为:每次询问 / 隐藏到托盘 / 直接退出。 */
export type CloseAction = "ask" | "tray" | "exit";
/** 界面语言:"auto" 跟随系统。 */
export type Language = "auto" | "zh" | "zh-TW" | "ja" | "en";
/** 统一侧栏的 Tab:目录(本文档大纲)或 文件(工作区目录树)。 */
export type SidebarTab = "toc" | "files";

interface SettingsState {
  /** Body font size in px. */
  fontSize: number;
  tocOpen: boolean;
  /** 侧栏当前显示哪个 Tab(侧栏开关仍是 tocOpen)。 */
  sidebarTab: SidebarTab;
  /** 内容铺满整个窗口宽度(否则 820px 居中)。 */
  fullWidth: boolean;
  /** 主视图模式:预览(渲染)或代码(原始 Markdown 源码)。 */
  viewMode: ViewMode;
  /** 编辑模式:代码视图出现可编辑覆盖层,预览视图 contentEditable。 */
  editMode: boolean;
  /** 关闭窗口行为(勾选"不再提醒"后由关闭对话框写入)。 */
  closeAction: CloseAction;
  language: Language;
  setFontSize: (n: number) => void;
  toggleToc: () => void;
  setSidebarTab: (v: SidebarTab) => void;
  toggleFullWidth: () => void;
  setViewMode: (v: ViewMode) => void;
  toggleEditMode: () => void;
  setCloseAction: (v: CloseAction) => void;
  setLanguage: (l: Language) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      fontSize: 17,
      tocOpen: true,
      sidebarTab: "toc",
      fullWidth: false,
      viewMode: "preview",
      editMode: false,
      closeAction: "ask",
      language: "auto",
      // 字号滑动过渡在 MarkdownView 的 font-size transition 中实现。
      setFontSize: (n) => set({ fontSize: Math.min(28, Math.max(13, n)) }),
      toggleToc: () => set((s) => ({ tocOpen: !s.tocOpen })),
      setSidebarTab: (v) => set({ sidebarTab: v }),
      toggleFullWidth: () => set((s) => ({ fullWidth: !s.fullWidth })),
      setViewMode: (v) => set({ viewMode: v }),
      toggleEditMode: () => set((s) => ({ editMode: !s.editMode })),
      setCloseAction: (v) => set({ closeAction: v }),
      setLanguage: (l) => set({ language: l }),
    }),
    { name: "openmd-settings" },
  ),
);
