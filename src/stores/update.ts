import { create } from "zustand";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { compareVersions, fetchLatestRelease } from "../utils/update-checker";

type Phase = "hidden" | "prompt" | "downloading" | "complete" | "error";
export type CheckResult = "idle" | "checking" | "latest" | "available" | "error";

/** GitCode 资产 URL 可能落在不可达 CDN,统一替换为主站域名(同 NexBox)。 */
const normalizeUrl = (url: string) =>
  url
    .replace("https://test.gitcode.net/", "https://gitcode.com/")
    .replace("https://download.gitcode.net/", "https://gitcode.com/");

interface UpdateState {
  phase: Phase;
  tag: string;
  url: string;
  body: string;
  assetUrl: string;
  assetName: string;
  progress: number;
  filePath: string;
  errorMsg: string;
  lastCheck: CheckResult;
  /** 检查更新:发现新版本时自动弹窗(phase=prompt) */
  check: () => Promise<CheckResult>;
  /** 下载安装包,期间监听 update-download-progress 事件更新进度 */
  startDownload: () => Promise<void>;
  /** 取消下载:后端中止并删除半成品 */
  cancelDownload: () => Promise<void>;
  /** 重启安装:启动安装向导并退出应用 */
  install: () => Promise<void>;
  /** 下载完成态点"取消":删除安装包并关闭弹窗 */
  discard: () => Promise<void>;
  /** 关闭弹窗(提示阶段) */
  hide: () => void;
  /** 重新打开弹窗(如发现新版本后用户关掉了) */
  show: () => void;
  setProgress: (n: number) => void;
}

export const useUpdate = create<UpdateState>((set, get) => ({
  phase: "hidden",
  tag: "",
  url: "",
  body: "",
  assetUrl: "",
  assetName: "",
  progress: 0,
  filePath: "",
  errorMsg: "",
  lastCheck: "idle",

  check: async () => {
    set({ lastCheck: "checking" });
    const current = await getVersion().catch(() => "1.0.0");
    const release = await fetchLatestRelease();
    if (!release) {
      set({ lastCheck: "error" });
      return "error";
    }
    if (!compareVersions(current, release.tag_name)) {
      set({ lastCheck: "latest" });
      return "latest";
    }
    const asset = release.assets?.find(
      (a) => a.name.endsWith(".exe") || a.name.endsWith(".msi"),
    );
    set({
      tag: release.tag_name,
      url: release.html_url,
      body: release.body ?? "",
      assetUrl: asset ? normalizeUrl(asset.browser_download_url) : "",
      assetName: asset?.name ?? "",
      phase: "prompt",
      lastCheck: "available",
      progress: 0,
    });
    return "available";
  },

  startDownload: async () => {
    const { assetUrl, assetName, phase } = get();
    if (!assetUrl || phase === "downloading") return;
    try {
      await invoke("reset_download_cancel");
    } catch {
      /* ignore */
    }
    set({ phase: "downloading", progress: 0 });
    try {
      const filePath = await invoke<string>("download_update", {
        url: assetUrl,
        fileName: assetName,
      });
      set({ phase: "complete", filePath, progress: 100 });
    } catch (e) {
      const msg = String(e);
      if (msg.includes("cancelled")) {
        set({ phase: "hidden" });
        return;
      }
      set({ phase: "error", errorMsg: msg });
    }
  },

  cancelDownload: async () => {
    try {
      await invoke("cancel_download");
    } catch {
      /* ignore */
    }
  },

  install: async () => {
    const { filePath } = get();
    if (!filePath) return;
    try {
      await invoke("install_update", { filePath });
    } catch (e) {
      set({ phase: "error", errorMsg: String(e) });
    }
  },

  discard: async () => {
    const { filePath } = get();
    if (filePath) {
      try {
        await invoke("delete_download_file", { filePath });
      } catch {
        /* ignore */
      }
    }
    set({ phase: "hidden", filePath: "" });
  },

  hide: () => set({ phase: "hidden" }),
  show: () => set((s) => (s.tag ? { phase: "prompt" } : s)),
  setProgress: (n) => set({ progress: n }),
}));
