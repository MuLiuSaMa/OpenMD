import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ViewMode = "preview" | "code";
/** 关闭窗口行为:每次询问 / 隐藏到托盘 / 直接退出。 */
export type CloseAction = "ask" | "tray" | "exit";
/** 界面语言:"auto" 跟随系统。 */
export type Language = "auto" | "zh" | "zh-TW" | "ja" | "en";
/** 统一侧栏的 Tab:目录(本文档大纲)或 文件(工作区目录树)。 */
export type SidebarTab = "toc" | "files";

/** 预览正文左右内边距的默认值(px),对齐预设"适中";"铺满"即把边距置 0。 */
export const DEFAULT_CONTENT_PADDING = 200;
/** 左右内边距上限(px)。去掉 820px 宽度上限后,宽屏需更大的边距才能收窄阅读栏。 */
export const MAX_CONTENT_PADDING = 480;

/** 自定义背景图默认模糊半径(px):够糊才不会干扰正文阅读。 */
export const DEFAULT_BACKGROUND_BLUR = 16;
/** 背景模糊上限(px)。 */
export const MAX_BACKGROUND_BLUR = 60;

interface SettingsState {
  /** Body font size in px. */
  fontSize: number;
  tocOpen: boolean;
  /** 侧栏当前显示哪个 Tab(侧栏开关仍是 tocOpen)。 */
  sidebarTab: SidebarTab;
  /**
   * 预览正文左右内边距(px),全局唯一值。
   * 0 即"铺满"(内容撑满窗口、无左右留白);不再是独立的铺满开关。
   */
  contentPadding: number;
  /** 自定义背景图片的绝对路径;null = 不启用背景图。 */
  backgroundImage: string | null;
  /** 背景图片的模糊半径(px),默认 [DEFAULT_BACKGROUND_BLUR]。 */
  backgroundBlur: number;
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
  setContentPadding: (n: number) => void;
  setBackgroundImage: (path: string | null) => void;
  setBackgroundBlur: (n: number) => void;
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
      contentPadding: DEFAULT_CONTENT_PADDING,
      backgroundImage: null,
      backgroundBlur: DEFAULT_BACKGROUND_BLUR,
      viewMode: "preview",
      editMode: false,
      closeAction: "ask",
      language: "auto",
      // 字号滑动过渡在 MarkdownView 的 font-size transition 中实现。
      setFontSize: (n) => set({ fontSize: Math.min(28, Math.max(13, n)) }),
      toggleToc: () => set((s) => ({ tocOpen: !s.tocOpen })),
      setSidebarTab: (v) => set({ sidebarTab: v }),
      // 预览左右边距:0-480px,与字号一样做钳制,避免滑块/输入越界。
      setContentPadding: (n) =>
        set({ contentPadding: Math.min(MAX_CONTENT_PADDING, Math.max(0, n)) }),
      setBackgroundImage: (path) => set({ backgroundImage: path }),
      // 背景模糊:0-60px。
      setBackgroundBlur: (n) =>
        set({ backgroundBlur: Math.min(MAX_BACKGROUND_BLUR, Math.max(0, n)) }),
      setViewMode: (v) => set({ viewMode: v }),
      toggleEditMode: () => set((s) => ({ editMode: !s.editMode })),
      setCloseAction: (v) => set({ closeAction: v }),
      setLanguage: (l) => set({ language: l }),
    }),
    { name: "openmd-settings" },
  ),
);
