import { getCurrentWindow } from "@tauri-apps/api/window";
import { LuMinus, LuX } from "react-icons/lu";
import { useCallback } from "react";

export default function TitleBar() {
  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    try {
      const appWindow = getCurrentWindow();
      await appWindow.startDragging();
    } catch { }
  }, []);

  const handleMinimize = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.minimize();
    } catch { }
  };

  const handleClose = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.close();
    } catch { }
  };

  return (
    <div className="titlebar" onMouseDown={handleMouseDown}>
      <div className="titlebar-spacer" />
      <div className="titlebar-controls">
        <button className="titlebar-btn" onClick={handleMinimize} aria-label="最小化">
          <LuMinus size={18} />
        </button>
        <button className="titlebar-btn titlebar-btn-close" onClick={handleClose} aria-label="关闭">
          <LuX size={18} />
        </button>
      </div>
    </div>
  );
}
