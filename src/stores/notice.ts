import { create } from "zustand";

interface NoticeState {
  /** 当前提示文案;null 表示不显示。 */
  text: string | null;
  /** 显示一条 3 秒后自动消失的底部提示。 */
  show: (text: string) => void;
  clear: () => void;
}

let timer: number | null = null;

/**
 * 底部居中的瞬时提示条(更新检查结果、链接打开失败等)。
 *
 * 放在 store 里而不是 App 的局部 state:任何组件都能提示一句,不必把回调
 * 一层层传下去;同一时刻只显示一条,后来的覆盖前一条并重置计时。
 */
export const useNotice = create<NoticeState>((set) => ({
  text: null,
  show: (text) => {
    if (timer !== null) window.clearTimeout(timer);
    set({ text });
    timer = window.setTimeout(() => {
      set({ text: null });
      timer = null;
    }, 3000);
  },
  clear: () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    set({ text: null });
  },
}));
