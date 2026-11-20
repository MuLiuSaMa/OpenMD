import { useEffect } from "react";
import { useSettings } from "../stores/settings";

const DEFAULT_UI_STACK =
  '"MiSans", "MiSans VF", -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
const DEFAULT_PREVIEW_STACK =
  '"MiSans", -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
const DEFAULT_CODE_STACK =
  '"Cascadia Code", "Cascadia Mono", Consolas, "JetBrains Mono", "Courier New", monospace';

export function formatFontStack(raw: string): string {
  return raw
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
    .map((name) => (/^(sans-serif|serif|monospace|system-ui)$/i.test(name) ? name : `"${name}"`))
    .join(", ");
}

export function buildFontFamily(parts: string[], fallback: string): string {
  const custom = parts.map(formatFontStack).filter(Boolean);
  return custom.length > 0 ? `${custom.join(", ")}, ${fallback}` : fallback;
}

/** 将设置中的 5 项字体配置实时同步到根元素的 CSS 变量。 */
export default function FontSync() {
  const uiFont = useSettings((s) => s.uiFont);
  const previewZhFont = useSettings((s) => s.previewZhFont);
  const previewEnFont = useSettings((s) => s.previewEnFont);
  const codeZhFont = useSettings((s) => s.codeZhFont);
  const codeEnFont = useSettings((s) => s.codeEnFont);

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--openmd-ui-font", buildFontFamily([uiFont], DEFAULT_UI_STACK));
    root.setProperty(
      "--openmd-preview-font",
      buildFontFamily([previewEnFont, previewZhFont], DEFAULT_PREVIEW_STACK),
    );
    root.setProperty(
      "--openmd-code-font",
      buildFontFamily([codeEnFont, codeZhFont], DEFAULT_CODE_STACK),
    );
  }, [uiFont, previewZhFont, previewEnFont, codeZhFont, codeEnFont]);

  return null;
}
