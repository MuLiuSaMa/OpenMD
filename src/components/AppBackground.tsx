import { Box } from "@chakra-ui/react";
import { useBackgroundSrc } from "../lib/useBackgroundSrc";
import { useSettings } from "../stores/settings";

/**
 * 自定义背景:整窗铺一张模糊图片,再叠一层主题色遮罩保证正文可读。
 *
 * 两个图层都用 z-index:-1 沉到最底(根容器不创建层叠上下文,所以能压在
 * 应用内容之下、又盖在画布底色之上),不占用布局、不吃指针事件。
 */
export function AppBackground() {
  const backgroundImage = useSettings((s) => s.backgroundImage);
  const backgroundBlur = useSettings((s) => s.backgroundBlur);
  const src = useBackgroundSrc(backgroundImage);

  if (!src) return null;

  return (
    <>
      <Box
        position="fixed"
        inset="0"
        zIndex={-1}
        pointerEvents="none"
        backgroundImage={`url("${src}")`}
        backgroundSize="cover"
        backgroundPosition="center"
        backgroundRepeat="no-repeat"
        // 放大一点,避免 blur 在四边透出透明描边。
        transform="scale(1.08)"
        filter={`blur(${backgroundBlur}px)`}
      />
      {/* 主题色遮罩:暗色主题压暗、亮色主题提亮,让正文在图上仍然清晰。 */}
      <Box position="fixed" inset="0" zIndex={-1} pointerEvents="none" bg="bg.canvas" opacity={0.55} />
    </>
  );
}
