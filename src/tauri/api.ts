import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

export const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown", "mkd"];

export async function readMarkdownFile(path: string): Promise<string> {
  return invoke("read_markdown_file", { path });
}

/** Persist edited markdown content back to the file (edit mode's save). */
export async function writeMarkdownFile(path: string, content: string): Promise<void> {
  return invoke("write_markdown_file", { path, content });
}

export async function resolvePath(path: string): Promise<string> {
  return invoke("resolve_path", { path });
}

export async function pathExists(path: string): Promise<boolean> {
  return invoke("path_exists", { path });
}

/** Allow the webview to fetch these images via the asset protocol. */
export async function allowAssets(documentPath: string, paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  return invoke("allow_assets", { documentPath, paths });
}

export async function watchFile(path: string): Promise<void> {
  return invoke("watch_file", { path });
}

export async function unwatchFile(path: string): Promise<void> {
  return invoke("unwatch_file", { path });
}

export interface FileChangedPayload {
  path: string;
}

export function onFileChanged(handler: (payload: FileChangedPayload) => void) {
  // 浏览器预览环境没有事件系统,降级为空监听。
  return listen<FileChangedPayload>("file-changed", (event) => handler(event.payload)).catch(
    () => () => {},
  );
}

export function onOpenedFiles(handler: (paths: string[]) => void) {
  return listen<string[]>("opened-files", (event) => handler(event.payload)).catch(
    () => () => {},
  );
}

/** Paths buffered by the Rust side before the webview was ready. */
export async function getOpenedFiles(): Promise<string[]> {
  return invoke("get_opened_files");
}

/** Native open-file dialog. Returns absolute paths, or null on cancel. */
export async function openFileDialog(): Promise<string[] | null> {
  return open({
    multiple: true,
    title: "打开 Markdown 文件",
    filters: [{ name: "Markdown", extensions: MARKDOWN_EXTENSIONS }],
  });
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"];

/** Native single-image picker for the editor's insert/replace actions. */
export async function openImageDialog(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    title: "选择图片",
    filters: [{ name: "图片", extensions: IMAGE_EXTENSIONS }],
  });
  if (Array.isArray(picked)) return picked[0] ?? null;
  return picked;
}

// ---- 用其他程序打开(扫描系统里能打开 Markdown 的程序) ----

export interface EditorApp {
  /** 显示名(FriendlyAppName / FriendlyTypeName,兑底 exe 文件名)。 */
  name: string;
  /** 解析出的真实 exe 路径。 */
  exe: string;
  /** exe 图标的 PNG data URL;提取失败为 null(前端回退通用图标)。 */
  icon: string | null;
  /** 系统关联了 .md(或用户最近用它打开过),菜单里排在前面。 */
  recommended: boolean;
}

/** 扫描系统里能打开 Markdown 的程序(.md 关联 + 全部已注册应用)。 */
export async function detectEditors(): Promise<EditorApp[]> {
  return invoke("detect_editors");
}

/** 用选中的程序打开文件。 */
export async function openFileWith(exe: string, path: string): Promise<void> {
  return invoke("open_file_with", { exe, path });
}

// ---- 运行时文件关联(.md 等扩展名 → OpenMD,HKCU 注册表) ----

export async function isMdAssociated(): Promise<boolean> {
  return invoke("is_md_associated");
}

export async function registerMdAssociation(): Promise<void> {
  return invoke("register_md_association");
}

export async function unregisterMdAssociation(): Promise<void> {
  return invoke("unregister_md_association");
}

/** 诊断日志(排查双击 .md 打不开) */
export async function logAssoc(message: string): Promise<void> {
  return invoke("log_assoc", { message });
}

// ---- QQ 群列表(设置页,数据来自 gitee) ----

export interface QqGroup {
  name: string;
  number: string;
  /** 加群链接(qm.qq.com),为空时点击退化为复制群号 */
  link: string;
  /** 群图标 URL(gitee raw),为空时显示默认 QQ 图标 */
  icon?: string;
}

export interface QqGroupsData {
  update_time: string;
  groups: QqGroup[];
}

export async function getQqGroups(): Promise<QqGroupsData> {
  return invoke("get_qq_groups");
}

/** 后端下载群图标到缓存,返回本地路径(配合 convertFileSrc 显示) */
export async function getQqGroupIcon(url: string): Promise<string> {
  return invoke("get_qq_group_icon", { url });
}
