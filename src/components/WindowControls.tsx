import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HStack, IconButton } from "@chakra-ui/react";
import { Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IN_TAURI, IS_MACOS } from "../utils/platform";

/** 窗口按钮边长:与顶栏等高(46px),三连排才能正好填满右上角。 */
const BTN_SIZE = "46px";

/**
 * 图标边长(px)。
 * Chakra 的 button recipe 在每个 size 变体里都用 `_icon: { width, height }`
 * 强制设 svg 宽高(默认 md = 20px),CSS 会压掉 lucide 的 size 属性 ——
 * 所以尺寸必须走 `_icon` 覆盖,否则怎么改 size 都没反应。
 */
const ICON_PX = 14;
const ICON_MAX_PX = 13;
const iconBox = (px: number) => ({ width: `${px}px`, height: `${px}px` });

/**
 * 窗口控制按钮:最小化 / 最大化(还原) / 关闭。
 * 用于去原生标题栏(decorations:false)后的自定义顶栏与首页悬浮区。
 * 浏览器预览环境不渲染。
 *
 * 三连排零间距、紧贴窗口右上角,只留一点圆角 —— 一旦留了内边距或按钮间距,
 * 右上角就会出现一块点不到关闭的"死区"。
 */
export function WindowControls() {
  const { t } = useTranslation();
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
  // macOS 走 titleBarStyle:"Overlay",由系统绘制红绿灯按钮,不再自绘一套。
  if (IS_MACOS) return null;

  // 中性灰按钮:图标用弱化前景色,悬停/按下只铺一层浅灰底,不再黑白反色。
  const mono = {
    variant: "ghost" as const,
    w: BTN_SIZE,
    h: BTN_SIZE,
    minW: BTN_SIZE,
    px: 0,
    borderRadius: "6px",
    color: "fg.muted",
    _icon: iconBox(ICON_PX),
    _hover: { bg: "bg.muted", color: "fg" },
    _active: { bg: "bg.emphasized", color: "fg" },
    _focusVisible: {
      boxShadow: "none",
      outline: "2px solid var(--chakra-colors-fg)",
      // 按钮贴着窗口边缘,外扩的描边会被裁掉,改成内缩。
      outlineOffset: "-2px",
    },
  };

  return (
    <HStack gap={0}>
      <IconButton aria-label={t("shell.minimize")} title={t("shell.minimize")} {...mono} onClick={() => void getCurrentWindow().minimize()}>
        <Minus size={ICON_PX} />
      </IconButton>
      <IconButton
        aria-label={maximized ? t("shell.restore") : t("shell.maximize")}
        title={maximized ? t("shell.restore") : t("shell.maximize")}
        {...mono}
        _icon={iconBox(ICON_MAX_PX)}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        {maximized ? <Copy size={ICON_MAX_PX} /> : <Square size={ICON_MAX_PX} />}
      </IconButton>
      <IconButton aria-label={t("shell.close")} title={t("shell.close")} {...mono} onClick={() => void getCurrentWindow().close()}>
        <X size={ICON_PX} />
      </IconButton>
    </HStack>
  );
}
