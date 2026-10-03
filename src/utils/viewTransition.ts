import { flushSync } from "react-dom";

/**
 * 在 View Transition 中应用一次状态更新:
 * 旧画面截图 → flushSync 同步提交新状态 → 新画面截图 → GPU 交叉淡入。
 * 整个过渡只有一次合成,不像逐元素 CSS 过渡那样在大文档上卡顿。
 * 浏览器不支持或系统开启"减弱动态效果"时,直接同步更新。
 */
export function withViewTransition(apply: () => void): void {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void | Promise<void>) => unknown;
  };
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    apply();
    return;
  }
  doc.startViewTransition(() => flushSync(apply));
}
