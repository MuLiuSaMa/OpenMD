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
  Slider,
  Text,
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
  Pencil,
  Plus,
  Save,
  Settings,
  StretchHorizontal,
  Sun,
} from "lucide-react";
import { useSettings, MAX_CONTENT_PADDING } from "../stores/settings";
import { useWorkspace } from "../stores/workspace";
import { openFolderDialog, openFileDialog } from "../tauri/api";
import { openStandaloneFiles } from "../lib/openStandaloneFiles";
import { isDirty, useTabs } from "../stores/tabs";
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
  const {
    fontSize,
    setFontSize,
    tocOpen,
    toggleToc,
    sidebarTab,
    setSidebarTab,
    contentPadding,
    setContentPadding,
    editMode,
    toggleEditMode,
  } = useSettings();
  const openPaths = useTabs((s) => s.openPath);
  const activeTab = useTabs((s) => s.tabs.find((x) => x.id === s.activeId));
  const saveTab = useTabs((s) => s.saveTab);
  // 编辑/保存属于「当前文档」:无打开的文档时不显示(首页不渲染顶栏,这里仅作兜底)。
  const canEdit = !!activeTab?.path;
  const dirty = activeTab ? isDirty(activeTab) : false;
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

  // 「边距」按钮的调节面板:悬停展开、离开延迟收起;开关都走 slide-fade 动画(与"打开"菜单一致)。
  const [paddingPhase, setPaddingPhase] = useState<"closed" | "open" | "closing">("closed");
  const paddingCloseTimer = useRef<number | null>(null);
  const paddingExitTimer = useRef<number | null>(null);
  // 包住"按钮 + 面板"的容器:面板是它的 DOM 子节点,用 :hover 判断指针是否还在控件范围内。
  const paddingWrapRef = useRef<HTMLDivElement | null>(null);

  const clearPaddingTimers = () => {
    if (paddingCloseTimer.current !== null) {
      window.clearTimeout(paddingCloseTimer.current);
      paddingCloseTimer.current = null;
    }
    if (paddingExitTimer.current !== null) {
      window.clearTimeout(paddingExitTimer.current);
      paddingExitTimer.current = null;
    }
  };

  const showPaddingPanel = () => {
    clearPaddingTimers();
    setPaddingPhase("open");
  };

  // 收起分两步:先切到 closing 播退场动画,动画结束再真正卸载。
  const closePaddingPanel = () => {
    clearPaddingTimers();
    setPaddingPhase((p) => (p === "closed" ? p : "closing"));
    paddingExitTimer.current = window.setTimeout(() => {
      paddingExitTimer.current = null;
      setPaddingPhase("closed");
    }, 120);
  };

  const schedulePaddingClose = () => {
    clearPaddingTimers();
    paddingCloseTimer.current = window.setTimeout(() => {
      paddingCloseTimer.current = null;
      closePaddingPanel();
    }, 120);
  };

  // 拖滑块时指针会滑出面板:按住期间不收起,松手后再判断是否已真正离开。
  const handlePaddingLeave = (e: { buttons: number }) => {
    if (e.buttons !== 0) return;
    schedulePaddingClose();
  };

  useEffect(() => clearPaddingTimers, []);

  useEffect(() => {
    const onPointerUp = () => {
      const el = paddingWrapRef.current;
      if (el && !el.matches(":hover")) closePaddingPanel();
    };
    window.addEventListener("pointerup", onPointerUp);
    return () => window.removeEventListener("pointerup", onPointerUp);
  }, []);

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
      // 右侧不留内边距:窗口按钮要贴到右上角,留白会让角落点不到关闭。
      // macOS 的 titleBarStyle:"Overlay" 会把红绿灯按钮叠在内容左上角,
      // 这里留出空档避免压住 Logo;其他平台保持原来的 3px。
      paddingLeft={IS_MACOS ? "78px" : "3px"}
      flexShrink={0}
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
          {/* 编辑/保存:从正文区移到顶栏「打开」左侧,作用于当前文档。 */}
          {canEdit && (
            <>
              <Button
                aria-label={t("viewer.toolbar.toggleEdit")}
                title={t("viewer.toolbar.editTitle")}
                variant="ghost"
                size="sm"
                gap={1.5}
                bg={editMode ? "fg" : "transparent"}
                color={editMode ? "bg" : "fg"}
                _hover={{ bg: editMode ? "fg.muted" : "bg.subtle" }}
                onClick={toggleEditMode}
              >
                <Pencil size={15} />
                {t("viewer.toolbar.edit")}
              </Button>
              <Button
                aria-label={t("viewer.toolbar.saveShortcut")}
                title={t("viewer.toolbar.saveShortcut")}
                variant="ghost"
                size="sm"
                gap={1.5}
                disabled={!dirty}
                onClick={() => activeTab && void saveTab(activeTab.id)}
              >
                <Save size={15} />
                {t("viewer.toolbar.save")}
              </Button>
            </>
          )}
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

          <Box
            ref={paddingWrapRef}
            position="relative"
            display="flex"
            alignItems="center"
            onPointerEnter={showPaddingPanel}
            onPointerLeave={handlePaddingLeave}
          >
            <Button
              aria-label={t("shell.margin")}
              title={t("shell.marginTitle")}
              variant="ghost"
              size="sm"
              gap={1.5}
              onClick={showPaddingPanel}
            >
              <StretchHorizontal size={15} />
              {t("shell.margin")}
              <ChevronDown size={12} opacity={0.55} />
            </Button>

            {/* 悬停展开的边距调节面板:实时改预览左右内边距。
                animationFillMode="both" 让退场动画播完后停在末态(opacity 0):
                Chakra 的 animationStyle 只给 animationName、不带 fill-mode,
                动画结束到定时卸载之间元素会回弹到不透明,肉眼就是"闪一下"。 */}
            {paddingPhase !== "closed" && (
              <Box
                data-placement="bottom"
                animationStyle={paddingPhase === "open" ? "slide-fade-in" : "slide-fade-out"}
                animationDuration={paddingPhase === "open" ? "fast" : "faster"}
                animationFillMode="both"
                position="absolute"
                top="100%"
                left="50%"
                transform="translateX(-50%)"
                mt={2}
                zIndex={1000}
                minW="220px"
                bg="bg"
                borderWidth="1px"
                borderColor="border.subtle"
                borderRadius="10px"
                boxShadow="md"
                p={3}
                onPointerEnter={showPaddingPanel}
                onPointerLeave={handlePaddingLeave}
              >
                <HStack justify="space-between" mb={2}>
                  <Text fontSize="xs" color="fg.muted">
                    {t("shell.contentPadding")}
                  </Text>
                  <Text fontSize="xs" color="fg.muted" fontVariantNumeric="tabular-nums">
                    {contentPadding}px
                  </Text>
                </HStack>
                <Slider.Root
                  min={0}
                  max={MAX_CONTENT_PADDING}
                  step={4}
                  size="sm"
                  value={[contentPadding]}
                  onValueChange={(e) => setContentPadding(e.value[0])}
                >
                  <Slider.Control>
                    <Slider.Track>
                      <Slider.Range />
                    </Slider.Track>
                    <Slider.Thumbs />
                  </Slider.Control>
                </Slider.Root>
                <HStack gap={1} mt={2}>
                  {(
                    [
                      { v: 0, label: t("shell.paddingNarrow") },
                      { v: 200, label: t("shell.paddingMedium") },
                      { v: 400, label: t("shell.paddingWide") },
                    ] as const
                  ).map((opt) => (
                    <Button
                      key={opt.v}
                      size="xs"
                      flex={1}
                      variant={contentPadding === opt.v ? "subtle" : "ghost"}
                      onClick={() => setContentPadding(opt.v)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </HStack>
              </Box>
            )}
          </Box>

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
