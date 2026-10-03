import { useEffect, useState } from "react";
import { HStack, IconButton } from "@chakra-ui/react";
import { Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** True when running inside the Tauri webview (false in a plain browser). */
const IN_TAURI = "__TAURI_INTERNALS__" in window;

/**
 * 窗口控制按钮:最小化 / 最大化(还原) / 关闭。
 * 用于去原生标题栏(decorations:false)后的自定义顶栏与首页悬浮区。
 * 浏览器预览环境不渲染。
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  // 跟踪最大化状态以切换图标;窗口尺寸变化时重新查询。
  useEffect(() => {
    if (!IN_TAURI) return;
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  if (!IN_TAURI) return null;

  // 全局 colorPalette 已是中性灰,这里再强制黑白反色,确保窗口按钮永远是黑白色。
  const mono = {
    variant: "ghost" as const,
    size: "sm" as const,
    color: "fg",
    _hover: { bg: "fg", color: "bg" },
    _active: { bg: "fg", color: "bg" },
    _focusVisible: {
      boxShadow: "none",
      outline: "2px solid var(--chakra-colors-fg)",
      outlineOffset: "2px",
    },
  };

  return (
    <HStack gap={1}>
      <IconButton aria-label="最小化" title="最小化" {...mono} onClick={() => void getCurrentWindow().minimize()}>
        <Minus size={15} />
      </IconButton>
      <IconButton
        aria-label={maximized ? "向下还原" : "最大化"}
        title={maximized ? "向下还原" : "最大化"}
        {...mono}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        {maximized ? <Copy size={13} /> : <Square size={13} />}
      </IconButton>
      <IconButton aria-label="关闭" title="关闭" {...mono} onClick={() => void getCurrentWindow().close()}>
        <X size={16} />
      </IconButton>
    </HStack>
  );
}
