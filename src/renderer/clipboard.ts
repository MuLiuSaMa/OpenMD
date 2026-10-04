import { readText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * Clipboard helpers for the content-area context menu.
 *
 * Writing text uses `navigator.clipboard.writeText` (already proven elsewhere
 * in the app). Reading text goes through the clipboard-manager plugin — the
 * webview's own `navigator.clipboard.readText` is not reliably permitted in
 * WebView2. Copying an image is best-effort: only same-origin/local sources
 * (asset protocol, data:, blob:) can be fetched without CORS trouble.
 */

/** Selected text (plain), or "" when nothing is selected. */
export function selectionText(): string {
  return window.getSelection()?.toString() ?? "";
}

/** Copy the current selection as plain text. */
export async function copySelection(): Promise<void> {
  const text = selectionText();
  if (text) await navigator.clipboard.writeText(text);
}

/** Paste text from the clipboard (plugin-backed; "" when unavailable). */
export async function readClipboardText(): Promise<string> {
  try {
    return await readText();
  } catch {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return "";
    }
  }
}

/** True for sources we can fetch without CORS problems (local/asset/data). */
export function isLocalImageSrc(src: string): boolean {
  return /^(?:asset:|http:\/\/asset\.localhost|data:|blob:)/i.test(src);
}

/**
 * Copy an <img> to the clipboard as PNG. Best-effort: remote (CORS-restricted)
 * images may fail; callers treat failure as a no-op with console.warn.
 */
export async function copyImage(img: HTMLImageElement): Promise<void> {
  const blob = await imageToPngBlob(img);
  // The webview reliably accepts image/png writes only.
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

async function imageToPngBlob(img: HTMLImageElement): Promise<Blob> {
  // Fetch the bytes first: a fetched blob re-drawn via createImageBitmap is
  // never canvas-tainted. Non-PNG (jpeg/webp/…) gets re-encoded.
  const resp = await fetch(img.currentSrc || img.src);
  const blob = await resp.blob();
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
}
