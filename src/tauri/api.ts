import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

export const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown", "mkd"];

export async function readMarkdownFile(path: string): Promise<string> {
  return invoke("read_markdown_file", { path });
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
