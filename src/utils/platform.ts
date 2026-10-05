/**
 * 运行平台判断。
 *
 * macOS 构建保留原生窗口(tauri.conf.json 的 `titleBarStyle: "Overlay"`),
 * 系统会在内容左上角绘制红绿灯按钮;自绘标题栏必须给它让出位置,并且不再
 * 渲染 Windows 风格的最小化/最大化/关闭按钮(否则出现两套窗口按钮)。
 *
 * 用 UA 判断而非 `@tauri-apps/plugin-os`:后者需要新增一个 Tauri 插件和对应的
 * capability 权限,而 UA 在所有 WKWebView/WebKit 上都稳定包含 "Macintosh"。
 */
const UA = typeof navigator === "undefined" ? "" : navigator.userAgent;

/** 是否为 macOS WebView。浏览器预览时同样返回 true(UI 与真实窗口保持一致)。 */
export const IS_MACOS = /Macintosh|Mac OS X/.test(UA);

/** 是否运行在 Tauri WebView 内(false 表示普通浏览器预览)。 */
export const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
