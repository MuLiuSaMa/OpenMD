import { useEffect } from "react";

/**
 * 弹窗/遮罩打开期间在 <html> 上挂 `overlay-open`,由全局 CSS 给 App 内容整体
 * 加 `filter: blur()`。
 *
 * 为什么不用 `Dialog.Backdrop` 的 `backdrop-filter`:在 WebView2 里它按合成层
 * 「部分生效」——带底色的元素(选中 tab、subtle 按钮、悬浮 chip)会被糊掉,
 * 无底色的文字却保持清晰,而背景图反而完全不糊。整体 `filter` 是确定性的。
 *
 * 用计数器兼容多个弹窗同时打开的情况。
 */
let openCount = 0;

export function useOverlayBlur(open: boolean) {
  useEffect(() => {
    if (!open) return;
    openCount += 1;
    document.documentElement.classList.add("overlay-open");
    return () => {
      openCount -= 1;
      if (openCount <= 0) {
        openCount = 0;
        document.documentElement.classList.remove("overlay-open");
      }
    };
  }, [open]);
}
