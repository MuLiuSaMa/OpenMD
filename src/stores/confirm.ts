import { create } from "zustand";

/** 「未保存修改」确认弹窗的用户选择。 */
export type UnsavedChoice = "save" | "discard" | "cancel";

interface ConfirmState {
  open: boolean;
  /** 展示在提示文案里的文件名。 */
  fileName: string;
  /** 当前挂起的 Promise 回调;由弹窗组件回填。 */
  resolve: ((choice: UnsavedChoice) => void) | null;
  /** 弹出「未保存修改」确认框,等待用户选择(保存 / 不保存 / 取消)。 */
  requestUnsaved: (fileName: string) => Promise<UnsavedChoice>;
  /** 由弹窗组件调用:回填结果并关闭。 */
  settleUnsaved: (choice: UnsavedChoice) => void;
}

/**
 * 自定义确认弹窗的桥接层:store 里的异步流程(如关闭标签页)无法直接渲染
 * React 组件,于是把请求挂在这里,由 <UnsavedDialog/> 渲染并回填结果,
 * 替代系统原生的 MessageBox。
 */
export const useConfirm = create<ConfirmState>((set, get) => ({
  open: false,
  fileName: "",
  resolve: null,

  requestUnsaved: (fileName) =>
    new Promise<UnsavedChoice>((resolve) => {
      // 上一个请求若还挂着,先按「取消」收尾,避免 Promise 永久悬空。
      get().resolve?.("cancel");
      set({ open: true, fileName, resolve });
    }),

  settleUnsaved: (choice) => {
    const { resolve } = get();
    set({ open: false, resolve: null });
    resolve?.(choice);
  },
}));
