import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

/**
 * 悬浮式滚动条:作为滚动容器的兄弟层叠加在右缘,不占布局宽度。
 * 滚动或悬停时淡入,停止约 1 秒后淡出;支持拖拽拇指与点击轨道跳转。
 * 拇指位置直接写 DOM 样式(不经过 React 状态),滚动时零重渲染不掉帧。
 * 宿主容器需要 position:relative,滚动元素本身加 no-scrollbar 隐藏原生条。
 */
export function FloatingScrollbar({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  const [hasBar, setHasBar] = useState(false);
  const [visible, setVisible] = useState(false);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ startY: number; startScroll: number; thumbH: number } | null>(null);

  // 滚动高帧路径:只做 DOM 样式写入;hasBar 极少变化,setState 有 bail-out。
  const update = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 1) {
      setHasBar(false);
      return;
    }
    setHasBar(true);
    const thumb = thumbRef.current;
    if (!thumb) return;
    const track = el.clientHeight;
    const height = Math.max(32, (el.clientHeight / el.scrollHeight) * track);
    const maxTop = track - height;
    const top = (el.scrollTop / (el.scrollHeight - el.clientHeight)) * Math.max(maxTop, 0);
    thumb.style.height = `${height}px`;
    thumb.style.top = `${top}px`;
  }, [targetRef]);

  const show = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), 900);
  }, []);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    update();
    const onScroll = () => {
      update();
      show();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // 内容或容器尺寸变化时重算(文档刷新、字号调整、窗口缩放)。
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [update, show, targetRef]);

  const onTrackDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = targetRef.current;
    const thumbH = thumbRef.current?.offsetHeight ?? 0;
    if (!el || !thumbH || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const trackScrollable = el.clientHeight - thumbH;
    const targetTop = Math.max(0, Math.min(trackScrollable, y - thumbH / 2));
    el.scrollTop = (targetTop / trackScrollable) * (el.scrollHeight - el.clientHeight);
    show();
  };

  const onThumbDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const el = targetRef.current;
    if (!el || !thumbRef.current) return;
    drag.current = {
      startY: e.clientY,
      startScroll: el.scrollTop,
      thumbH: thumbRef.current.offsetHeight,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onThumbMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = drag.current;
    const el = targetRef.current;
    if (!st || !el) return;
    const trackScrollable = el.clientHeight - st.thumbH;
    if (trackScrollable <= 0) return;
    el.scrollTop =
      st.startScroll + ((e.clientY - st.startY) / trackScrollable) * (el.scrollHeight - el.clientHeight);
  };

  const onThumbUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    show();
  };

  if (!hasBar) return null;

  return (
    <div
      ref={rootRef}
      className={`floating-scrollbar${visible ? " show" : ""}`}
      onPointerEnter={() => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        setVisible(true);
      }}
      onPointerLeave={() => {
        if (!dragging) show();
      }}
    >
      <div className="fs-hit" onPointerDown={onTrackDown}>
        <div
          ref={thumbRef}
          className="fs-thumb"
          onPointerDown={onThumbDown}
          onPointerMove={onThumbMove}
          onPointerUp={onThumbUp}
        />
      </div>
    </div>
  );
}
