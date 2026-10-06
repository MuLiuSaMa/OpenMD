import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

// MiSans 可变字体(全字重),全局默认字体;回退到系统字体栈。
const APP_FONTS =
  '"MiSans", "MiSans VF", -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
const MONO_FONTS =
  '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", Consolas, "Courier New", monospace';

const config = defineConfig({
  globalCss: {
    html: {
      colorPalette: "gray",
      // 页面兜底底色:最大化/还原窗口时 WebView2 会先清一帧再重绘,
      // 没有底色就会闪白。自定义背景图时根容器是透明的,更容易暴露出来。
      bg: "bg.canvas",
    },
    body: {
      fontFamily: APP_FONTS,
      overflow: "hidden",
      bg: "bg.canvas",
    },
  },
  theme: {
    // 首页 ↔ 文档页切换的入场动画关键帧。
    keyframes: {
      "view-in": {
        from: { opacity: 0, transform: "translateY(8px) scale(0.995)" },
        to: { opacity: 1, transform: "translateY(0) scale(1)" },
      },
      // 顶栏字号数字的弹跳。
      "num-pop": {
        from: { opacity: 0.3, transform: "scale(0.7)" },
        to: { opacity: 1, transform: "scale(1)" },
      },
    },
    tokens: {
      fonts: {
        heading: { value: APP_FONTS },
        body: { value: APP_FONTS },
        mono: { value: MONO_FONTS },
      },
    },
  },
});

/** 首页 ↔ 文档页切换时,新视图入场:淡入 + 轻微上移,遵循系统减弱动效设置。 */
export const viewInAnimation = {
  animationName: "view-in",
  animationDuration: "0.3s",
  animationTimingFunction: "ease-out",
  // 用 backwards 而不是 both:动画结束后不再保留末态的常驻 transform。
  // 常驻 transform 会把容器提升为合成层,窗口最大化/还原时重新栅格化容易闪。
  animationFillMode: "backwards",
  _motionReduce: { animation: "none" },
} as const;

export const system = createSystem(defaultConfig, config);
