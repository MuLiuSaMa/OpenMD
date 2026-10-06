import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  Grid,
  HStack,
  IconButton,
  Input,
  Menu,
  Portal,
  Separator,
} from "@chakra-ui/react";
import { useTheme } from "next-themes";
import {
  ChevronDown,
  FileText,
  FolderOpen,
  FolderTree,
  Minus,
  Moon,
  PanelLeft,
  Plus,
  Settings,
  StretchHorizontal,
  Sun,
} from "lucide-react";
import { useSettings } from "../stores/settings";
import { useWorkspace } from "../stores/workspace";
import { openFolderDialog, openFileDialog } from "../tauri/api";
import { openStandaloneFiles } from "../lib/openStandaloneFiles";
import { useTabs } from "../stores/tabs";
import { withViewTransition } from "../utils/viewTransition";
import { IS_MACOS } from "../utils/platform";
import { SettingsModal } from "./SettingsModal";
import { WindowControls } from "./WindowControls";

function ThemeToggle() {
  const { t } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  // 主题切换用 View Transition 交叉淡入,避免全文档逐元素颜色过渡卡顿。
  const toggle = () => {
    withViewTransition(() => setTheme(isDark ? "light" : "dark"));
  };
  return (
    <IconButton
      aria-label={t("shell.toggleTheme")}
      title={t("shell.toggleThemeTitle")}
      variant="ghost"
      size="sm"
      onClick={toggle}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </IconButton>
  );
}

export function TitleBar({ onOpenError }: { onOpenError?: (msg: string) => void }) {
  const { t } = useTranslation();
  const { fontSize, setFontSize, tocOpen, toggleToc, sidebarTab, setSidebarTab, fullWidth, toggleFullWidth } =
    useSettings();
  const openPaths = useTabs((s) => s.openPath);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  // 字号输入框的本地草稿:回车/失焦时提交,外部变更(按钮/快捷键)时同步。
  const [sizeDraft, setSizeDraft] = useState(String(fontSize));
  useEffect(() => {
    setSizeDraft(String(fontSize));
  }, [fontSize]);
  const commitSize = () => {
    const n = Number.parseInt(sizeDraft, 10);
    if (Number.isNaN(n)) {
      setSizeDraft(String(fontSize));
    } else {
      setFontSize(n);
    }
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState(false);
  const openMenuCloseTimer = useRef<number | null>(null);

  const cancelOpenMenuClose = () => {
    if (openMenuCloseTimer.current !== null) {
      window.clearTimeout(openMenuCloseTimer.current);
      openMenuCloseTimer.current = null;
    }
  };

  const showOpenMenu = () => {
    cancelOpenMenuClose();
    setOpenMenu(true);
  };

  const scheduleOpenMenuClose = () => {
    cancelOpenMenuClose();
    openMenuCloseTimer.current = window.setTimeout(() => {
      openMenuCloseTimer.current = null;
      setOpenMenu(false);
    }, 120);
  };

  useEffect(() => cancelOpenMenuClose, []);

  const handleOpen = async () => {
    try {
      const paths = await openFileDialog();
      await openStandaloneFiles(paths ?? []);
    } catch (e) {
      onOpenError?.(String(e));
    }
  };

  // 目录按钮与 Tab 联动:侧栏开着但显示文件页时,点击是切换而不是关闭。
  const tocShown = tocOpen && sidebarTab === "toc";
  const handleWorkspace = async () => {
    // 打开文件夹是内容操作,不应复用侧栏按钮的收起逻辑。
    setSidebarTab("files");
    if (!tocOpen) toggleToc();
    const picked = await openFolderDialog().catch((e) => {
      onOpenError?.(String(e));
      return null;
    });
    if (!picked) return;
    // 选完文件夹直接进预览页(有文档就打开第一篇),而不是只把树塞进侧栏。
    const { firstDoc } = await useWorkspace.getState().openFolder(picked);
    if (firstDoc) await openPaths(firstDoc);
  };
  const handleTocButton = () => {
    if (tocOpen && sidebarTab === "files") {
      setSidebarTab("toc");
      return;
    }
    toggleToc();
  };

  // 三列网格:左 Logo、中功能、右窗口控制,保证功能组在窗口中真正居中。
  // 去原生标题栏后,整条顶栏都是拖拽区(data-tauri-drag-region);
  // 按钮自身不带该属性,点击不受影响。双击拖拽区可最大化/还原。
  return (
    <Box
      as="header"
      h="46px"
      px={4}
      // macOS 的 titleBarStyle:"Overlay" 会把红绿灯按钮叠在内容左上角,
      // 这里留出空档避免压住 Logo;其他平台保持原来的 3px。
      paddingLeft={IS_MACOS ? "78px" : "3px"}
      flexShrink={0}
      borderBottomWidth="1px"
      borderColor="border.subtle"
      userSelect="none"
      display="flex"
      alignItems="center"
      data-tauri-drag-region=""
    >
      <Grid templateColumns="1fr auto 1fr" w="100%" alignItems="center" data-tauri-drag-region="">
        <Box justifySelf="start" display="flex" alignItems="center" data-tauri-drag-region="">
          {/* wordmark PNG 上下各有约34%透明留白(字形仅占30%高度),
              用固定高度容器 + 负 margin 裁剪到字形本身,栏高保持紧凑。 */}
          <Box h="18px" overflow="hidden" display="flex" flexShrink={0} data-tauri-drag-region="">
            <img
              src={isDark ? "/wordmark-white.png" : "/wordmark-black.png"}
              alt="OpenMD"
              draggable={false}
              data-tauri-drag-region=""
              style={{
                height: "59px",
                width: "auto",
                marginTop: "-20px",
                mixBlendMode: isDark ? "screen" : "multiply",
                userSelect: "none",
              }}
            />
          </Box>
        </Box>

        <HStack gap={1} justifySelf="center" data-tauri-drag-region="">
          <Menu.Root
            open={openMenu}
            onOpenChange={(e) => setOpenMenu(e.open)}
            positioning={{ placement: "bottom-start" }}
          >
            <Menu.Trigger asChild>
              <Button
                aria-label={t("shell.open")}
                title={t("shell.open")}
                variant="ghost"
                size="sm"
                gap={1.5}
                onPointerEnter={showOpenMenu}
                onPointerLeave={scheduleOpenMenuClose}
              >
                <FolderOpen size={15} />
                {t("shell.open")}
                <ChevronDown size={12} opacity={0.55} />
              </Button>
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner zIndex={1000}>
                <Menu.Content
                  minW="160px"
                  bg="bg"
                  borderWidth="1px"
                  borderColor="border.subtle"
                  borderRadius="10px"
                  boxShadow="md"
                  overflow="hidden"
                  p={1}
                  onPointerEnter={showOpenMenu}
                  onPointerLeave={scheduleOpenMenuClose}
                >
                  <Menu.Item
                    value="open-file"
                    display="flex"
                    alignItems="center"
                    gap={2}
                    fontSize="sm"
                    px={2}
                    py={1.5}
                    borderRadius="6px"
                    cursor="pointer"
                    onClick={() => void handleOpen()}
                  >
                    <FileText size={14} />
                    {t("shell.openFile")}
                  </Menu.Item>
                  <Menu.Item
                    value="open-folder"
                    display="flex"
                    alignItems="center"
                    gap={2}
                    fontSize="sm"
                    px={2}
                    py={1.5}
                    borderRadius="6px"
                    cursor="pointer"
                    onClick={() => void handleWorkspace()}
                  >
                    <FolderTree size={14} />
                    {t("shell.openFolder")}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>

          <Separator orientation="vertical" h="20px" />

          <IconButton
            aria-label={t("shell.decreaseFontSize")}
            title={t("shell.decreaseFontSizeShortcut")}
            variant="ghost"
            size="sm"
            onClick={() => setFontSize(fontSize - 1)}
          >
            <Minus size={15} />
          </IconButton>
          <Input
            type="number"
            min={13}
            max={28}
            value={sizeDraft}
            onChange={(e) => setSizeDraft(e.target.value)}
            onBlur={commitSize}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            aria-label={t("shell.fontSize")}
            title={t("shell.fontSizeInputTitle")}
            w="44px"
            h="26px"
            size="xs"
            px={0}
            textAlign="center"
            borderRadius="6px"
            bg="bg.subtle"
            borderColor="transparent"
            focusRing="none"
            _hover={{ borderColor: "fg.muted" }}
            _focusVisible={{ borderColor: "fg.muted" }}
            css={{
              "&::-webkit-outer-spin-button, &::-webkit-inner-spin-button": {
                WebkitAppearance: "none",
                margin: 0,
              },
              MozAppearance: "textfield",
            }}
          />
          <IconButton
            aria-label={t("shell.increaseFontSize")}
            title={t("shell.increaseFontSizeShortcut")}
            variant="ghost"
            size="sm"
            onClick={() => setFontSize(fontSize + 1)}
          >
            <Plus size={15} />
          </IconButton>

          <Separator orientation="vertical" h="20px" />

          <Button
            aria-label={t("shell.tocBar")}
            title={t("shell.tocBarShortcut")}
            variant={tocShown ? "subtle" : "ghost"}
            size="sm"
            gap={1.5}
            onClick={handleTocButton}
          >
            <PanelLeft size={15} />
            {t("shell.toc")}
          </Button>

          <Button
            aria-label={t("shell.fullWidth")}
            title={t("shell.fullWidthTitle")}
            variant={fullWidth ? "subtle" : "ghost"}
            size="sm"
            gap={1.5}
            onClick={toggleFullWidth}
          >
            <StretchHorizontal size={15} />
            {t("shell.fullWidthLabel")}
          </Button>

          <Button
            aria-label={t("shell.settings")}
            title={t("shell.settings")}
            variant="ghost"
            size="sm"
            gap={1.5}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={15} />
            {t("shell.settings")}
          </Button>

          <ThemeToggle />
        </HStack>

        <Box justifySelf="end" display="flex" alignItems="center" data-tauri-drag-region="">
          <WindowControls />
        </Box>
      </Grid>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Box>
  );
}
