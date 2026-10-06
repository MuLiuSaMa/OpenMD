import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Flex, Box } from "@chakra-ui/react";
import { TitleBar } from "./components/TitleBar";
import { TabBar } from "./components/TabBar";
import { Sidebar } from "./components/Sidebar";
import { MarkdownView } from "./components/MarkdownView";
import { EmptyState } from "./components/EmptyState";
import { StatusBar } from "./components/StatusBar";
import { UpdatePopup } from "./components/UpdatePopup";
import { AppBackground } from "./components/AppBackground";
import { CloseDialog } from "./components/CloseDialog";
import { UnsavedDialog } from "./components/UnsavedDialog";
import { HOME_TAB_ID, useTabs } from "./stores/tabs";
import { useSettings } from "./stores/settings";
import { useWorkspace } from "./stores/workspace";
import { useUpdate } from "./stores/update";
import { IS_STORE_BUILD } from "./lib/build-flags";
import { openStandaloneFiles } from "./lib/openStandaloneFiles";
import { viewInAnimation } from "./theme/theme";
import {
  getOpenedFiles,
  isDirectory,
  logAssoc,
  MARKDOWN_EXTENSIONS,
  onFileChanged,
  onOpenedFiles,
  onWorkspaceChanged,
  openFileDialog,
  openFolderDialog,
} from "./tauri/api";

/** True when running inside the Tauri webview (false in a plain browser). */
const inTauri = "__TAURI_INTERNALS__" in window;

function isMarkdownPath(p: string): boolean {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return MARKDOWN_EXTENSIONS.includes(ext);
}

export default function App() {
  const { t } = useTranslation();
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const refreshPath = useTabs((s) => s.refreshPath);
  const { tocOpen, backgroundImage } = useSettings();
  const [openError, setOpenError] = useState<string | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  // 托盘"检查更新"的结果提示(已是最新/失败);发现新版本时直接弹更新弹窗
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const restoredRef = useRef(false);

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];

  // 启动自动检查更新(GitCode release,带令牌认证);发现新版本时右下角弹更新弹窗。
  // 商店版(MSIX)更新由商店接管,不做任何应用内更新。
  useEffect(() => {
    if (!inTauri || IS_STORE_BUILD) return;
    const timer = window.setTimeout(() => {
      void useUpdate.getState().check();
    }, 1500);
    // 下载进度事件 → store
    const unlisten = listen<{ progress: number }>("update-download-progress", (e) => {
      useUpdate.getState().setProgress(e.payload.progress);
    });
    return () => {
      window.clearTimeout(timer);
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  // 托盘事件:关闭询问(点 X 被 Rust 拦截)与"检查更新"菜单项。
  useEffect(() => {
    if (!inTauri) return;
    const unlistenClose = listen("close-requested", () => {
      const action = useSettings.getState().closeAction;
      if (action === "tray") {
        void invoke("hide_to_tray").catch(() => {});
      } else if (action === "exit") {
        void invoke("quit_app").catch(() => {});
      } else {
        setCloseDialogOpen(true);
      }
    });
    const unlistenTrayCheck = listen("tray-check-update", () => {
      // 商店版托盘菜单不含此项;双保险避免商店外更新入口。
      if (IS_STORE_BUILD) return;
      void useUpdate.getState().check().then((result) => {
        if (result === "latest") showNotice(t("shell.upToDate"));
        else if (result === "error") showNotice(t("shell.updateCheckFailed"));
        // available 时更新弹窗自动弹出,无需额外提示
      });
    });
    return () => {
      unlistenClose.then((fn) => fn()).catch(() => {});
      unlistenTrayCheck.then((fn) => fn()).catch(() => {});
    };
  }, []);

  // 底部居中提示条(3 秒自动消失)
  const showNotice = (text: string) => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setNotice(text);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, 3000);
  };

  // 启动固定停留在首页(不自动恢复上次会话);只处理系统"打开方式"
  // /拖拽缓冲的文件请求。在纯浏览器环境(开发预览)不处理。
  // startupReady:启动排水(打开关联文件)完成前不渲染首页,避免闪一下主页。
  const [startupReady, setStartupReady] = useState(!inTauri);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    (async () => {
      if (inTauri) {
        const buffered = await getOpenedFiles().catch((e) => {
          void logAssoc(`startup getOpenedFiles FAILED: ${e}`);
          return [];
        });
        void logAssoc(`startup drained ${buffered.length} buffered: ${buffered.join(", ")}`);
        await openStandaloneFiles(buffered);
      }
      setStartupReady(true);
    })();
  }, []);

  // OS file watchers → refresh the tab that owns the file. Per-path 100ms
  // coalescing (editors fire several events per save) plus a suppression
  // window after our own save — the tab already holds that content.
  useEffect(() => {
    if (!inTauri) return;
    const pending = new Map<string, number>();
    const OWN_SAVE_SUPPRESSION_MS = 1500;
    const COALESCE_MS = 100;
    const unlistenFileChanged = onFileChanged(({ path }) => {
      const prev = pending.get(path);
      if (prev) window.clearTimeout(prev);
      pending.set(
        path,
        window.setTimeout(() => {
          pending.delete(path);
          const tab = useTabs.getState().tabs.find((t) => t.path === path);
          if (tab?.lastSavedAt && Date.now() - tab.lastSavedAt < OWN_SAVE_SUPPRESSION_MS) return;
          void refreshPath(path);
        }, COALESCE_MS),
      );
    });
    const unlistenOpened = onOpenedFiles((paths) => {
      void logAssoc(`frontend opened-files event: ${paths.join(", ")}`);
      void openStandaloneFiles(paths);
    });
    // 工作区目录树的外部变更(store 内部有拖尾合并,重拉展开目录)
    const unlistenWorkspace = onWorkspaceChanged(({ path }) => {
      useWorkspace.getState().refresh(path);
    });
    return () => {
      unlistenFileChanged.then((fn) => fn());
      unlistenOpened.then((fn) => fn());
      unlistenWorkspace.then((fn) => fn());
    };
  }, [refreshPath]);

  // 全局禁用 WebView2 默认右键菜单;内容区的自定义菜单在 MarkdownView 里,
  // 内容区之外右键静默无菜单。
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // Drag & drop onto the window: .md files open as tabs, folders open as
  // the workspace tree.
  useEffect(() => {
    if (!inTauri) return;
    const promise = getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          const markdownPaths: string[] = [];
          for (const p of event.payload.paths) {
            if (isMarkdownPath(p)) {
              markdownPaths.push(p);
              continue;
            }
            void isDirectory(p)
              .then((isDir) => {
                if (isDir) void useWorkspace.getState().openFolder(p);
              })
              .catch(() => {});
          }
          if (markdownPaths.length > 0) void openStandaloneFiles(markdownPaths);
        }
      })
      .catch((e) => {
        console.error("drag-drop init failed:", e);
        return () => {};
      });
    return () => {
      promise.then((fn) => fn());
    };
  }, []);

  // Window title follows the active tab.
  useEffect(() => {
    if (!inTauri) return;
    const name = activeTab?.path ? activeTab.name : "OpenMD";
    getCurrentWindow()
      .setTitle(name === "OpenMD" ? "OpenMD" : `${name} - OpenMD`)
      .catch(() => {});
  }, [activeTab]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const state = useTabs.getState();
      const key = e.key.toLowerCase();

      if (key === "o") {
        e.preventDefault();
        if (e.shiftKey) {
          // Ctrl+Shift+O:选择文件夹打开为工作区
          openFolderDialog()
            .then((p) => {
              if (p) void useWorkspace.getState().openFolder(p);
            })
            .catch((err) => setOpenError(String(err)));
        } else {
          openFileDialog()
            .then((paths) => {
              void openStandaloneFiles(paths ?? []);
            })
            .catch((err) => setOpenError(String(err)));
        }
      } else if (key === "w") {
        if (state.activeId !== HOME_TAB_ID) {
          e.preventDefault();
          void state.requestCloseTab(state.activeId);
        }
      } else if (key === "s") {
        e.preventDefault();
        void state.saveTab(state.activeId);
      } else if (key === "e") {
        e.preventDefault();
        useSettings.getState().toggleEditMode();
      } else if (key === "tab") {
        e.preventDefault();
        const idx = state.tabs.findIndex((t) => t.id === state.activeId);
        const next = e.shiftKey
          ? state.tabs[(idx - 1 + state.tabs.length) % state.tabs.length]
          : state.tabs[(idx + 1) % state.tabs.length];
        if (next) state.setActive(next.id);
      } else if (key === "b") {
        e.preventDefault();
        useSettings.getState().toggleToc();
      } else if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        const { fontSize, setFontSize } = useSettings.getState();
        setFontSize(fontSize + 1);
      } else if (e.key === "-") {
        e.preventDefault();
        const { fontSize, setFontSize } = useSettings.getState();
        setFontSize(fontSize - 1);
      } else if (e.key === "0") {
        e.preventDefault();
        useSettings.getState().setFontSize(17);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const showSidebar = tocOpen && activeTab?.path !== null && activeTab !== undefined;
  // 首页(无文档打开)整页留白,只显示居中文字 Logo。
  const isHome = !activeTab?.path;
  // 启动排水未完成前只渲染空白底色(正在打开关联文件),避免首页闪现。

  return (
    <Flex
      direction="column"
      h="100vh"
      // 有自定义背景图时让出底色,露出底层的模糊图片;无背景时保持原来的画布色。
      bg={backgroundImage ? "transparent" : "bg.canvas"}
      color="fg"
    >
      <AppBackground />
      {!startupReady ? (
        <Box flex={1} bg="bg" />
      ) : isHome ? (
        <EmptyState />
      ) : (
        <Flex direction="column" flex={1} minH={0} {...viewInAnimation}>
          <TitleBar onOpenError={setOpenError} />
          <TabBar />
          <Flex flex={1} minH={0}>
            {activeTab && <Sidebar open={showSidebar} />}
            {activeTab && <MarkdownView key={activeTab.id} tab={activeTab} />}
          </Flex>
          <StatusBar />
        </Flex>
      )}
      {notice && (
        <Flex
          position="fixed"
          bottom="36px"
          left="50%"
          transform="translateX(-50%)"
          bg="fg"
          color="bg"
          px={4}
          py={2}
          borderRadius="md"
          fontSize="xs"
          boxShadow="lg"
          zIndex={100}
        >
          {notice}
        </Flex>
      )}
      {openError && (
        <Flex
          position="fixed"
          bottom="36px"
          left="50%"
          transform="translateX(-50%)"
          bg="red.500"
          color="white"
          px={4}
          py={2}
          borderRadius="md"
          fontSize="xs"
          cursor="pointer"
          onClick={() => setOpenError(null)}
          boxShadow="lg"
          zIndex={100}
        >
          {t("shell.openErrorClickToDismiss", { error: openError })}
        </Flex>
      )}
      <UpdatePopup />
      <CloseDialog open={closeDialogOpen} onClose={() => setCloseDialogOpen(false)} />
      <UnsavedDialog />
    </Flex>
  );
}
