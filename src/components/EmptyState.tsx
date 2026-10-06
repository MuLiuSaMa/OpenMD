import { useRef, useState } from "react";
import { Box, Button, Flex, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { FileText, FolderOpen, FolderTree, Settings, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { useTabs } from "../stores/tabs";
import { useRecent, type RecentFile } from "../stores/recent";
import { useWorkspace } from "../stores/workspace";
import { openFolderDialog, openFileDialog } from "../tauri/api";
import { openStandaloneFiles } from "../lib/openStandaloneFiles";
import { viewInAnimation } from "../theme/theme";
import { FloatingScrollbar } from "./FloatingScrollbar";
import { SettingsModal } from "./SettingsModal";
import { WindowControls } from "./WindowControls";

/** 去掉文件名,取所在目录路径。 */
function dirOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx === -1 ? path : path.slice(0, idx);
}

/**
 * 首页:无历史时整页留白居中显示文字 Logo + 打开按钮;
 * 有打开过的文档后改为左右布局 —— 左侧 Logo + 打开按钮,
 * 右侧"最近打开"列表(点击重新打开,悬停可移除)。
 * 暗色主题用白色字标,亮色用黑色字标;mix-blend-mode 让黑/白底图
 * 在任何背景下都只剩字形本身。Ctrl+O 或拖 .md 进窗口同样可以打开。
 */
export function EmptyState() {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const openPaths = useTabs((s) => s.openPath);
  const recents = useRecent((s) => s.files);
  const removeRecent = useRecent((s) => s.remove);
  const clearRecents = useRecent((s) => s.clear);
  const recentListRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // next-themes 首帧 resolvedTheme 为 undefined,默认按暗色处理。
  const isDark = resolvedTheme !== "light";

  /** 今天显示 HH:mm,今年显示 M月d日,更早显示 年/M/d。 */
  const formatTs = (ts: number): string => {
    const d = new Date(ts);
    const now = new Date();
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (d.toDateString() === now.toDateString()) return hm;
    if (d.getFullYear() === now.getFullYear())
      return t("misc.dateMonthDay", { month: d.getMonth() + 1, day: d.getDate() });
    return t("misc.dateFull", {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
    });
  };

  const handleClick = async () => {
    try {
      const paths = await openFileDialog();
      await openStandaloneFiles(paths ?? []);
    } catch {
      /* 用户取消或浏览器环境 */
    }
  };

  // 打开文件夹为工作区:打开后直接进预览页 —— 有文档就打开第一篇,用户不必再
  // 点一次侧栏;完全没有文档时停在 Logo 首页(侧栏树会提示"此文件夹中没有文档")。
  // 取消对话框则什么都不做。
  const handleOpenFolder = async () => {
    try {
      const picked = await openFolderDialog();
      if (!picked) return;
      const { firstDoc } = await useWorkspace.getState().openFolder(picked);
      if (firstDoc) await openPaths(firstDoc);
    } catch {
      /* 用户取消或浏览器环境 */
    }
  };

  const wordmark = (
    <img
      src={isDark ? "/wordmark-white.png" : "/wordmark-black.png"}
      alt="OpenMD"
      draggable={false}
      style={{
        width: recents.length > 0 ? "min(340px, 28vw)" : "min(480px, 62vw)",
        height: "auto",
        mixBlendMode: isDark ? "screen" : "multiply",
        userSelect: "none",
      }}
    />
  );

  const openButton = (
    <Button
      size="sm"
      variant="outline"
      bg="transparent"
      borderColor="fg"
      color="fg"
      borderRadius="8px"
      px={6}
      h="38px"
      _hover={{ bg: "fg", color: "bg" }}
      _active={{ transform: "scale(0.98)" }}
      transition="all 0.15s"
      onClick={handleClick}
    >
      <FolderOpen size={15} />
      {t("misc.openFile")}
    </Button>
  );

  const folderButton = (
    <Button
      size="sm"
      variant="outline"
      bg="transparent"
      borderColor="fg"
      color="fg"
      borderRadius="8px"
      px={6}
      h="38px"
      _hover={{ bg: "fg", color: "bg" }}
      _active={{ transform: "scale(0.98)" }}
      transition="all 0.15s"
      onClick={handleOpenFolder}
    >
      <FolderTree size={15} />
      {t("misc.openFolder")}
    </Button>
  );

  const actionButtons = (
    <HStack gap={3}>
      {openButton}
      {folderButton}
    </HStack>
  );

  // 首页无标题栏:顶部一条透明拖拽区(双击可最大化),右上角窗口控制按钮。
  const topDragArea = (
    <Box
      position="absolute"
      top={0}
      left={0}
      right={0}
      h="42px"
      zIndex={10}
      data-tauri-drag-region=""
    >
      <Box position="absolute" top={1.5} right={2} data-tauri-drag-region="">
        <WindowControls />
      </Box>
    </Box>
  );

  // 左下角设置入口。
  const settingsButton = (
    <Button
      position="absolute"
      bottom={5}
      left={5}
      variant="ghost"
      size="sm"
      gap={1.5}
      color="fg.muted"
      _hover={{ color: "fg", bg: "bg.subtle" }}
      onClick={() => setSettingsOpen(true)}
    >
      <Settings size={15} />
      {t("misc.settings")}
    </Button>
  );

  // 设置弹窗在两种首页布局下共用一份。
  const settingsModal = (
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
  );

  // 没有打开过的文档:保持居中留白布局。
  if (recents.length === 0) {
    return (
      <Box
        flex={1}
        bg="bg"
        display="flex"
        alignItems="center"
        justifyContent="center"
        position="relative"
        {...viewInAnimation}
      >
        {topDragArea}
        {settingsButton}
        <VStack gap={12}>
          {wordmark}
          {actionButtons}
        </VStack>
        {settingsModal}
      </Box>
    );
  }

  return (
    <Box
      flex={1}
      bg="bg"
      display="flex"
      alignItems="center"
      justifyContent="center"
      overflow="auto"
      position="relative"
      {...viewInAnimation}
    >
      {topDragArea}
      {settingsButton}
      <Flex align="center" gap={20} px={12} py={10}>
        {/* 左侧:Logo + 打开按钮 */}
        <VStack gap={10} flexShrink={0}>
          {wordmark}
          {actionButtons}
        </VStack>

        {/* 右侧:最近打开的文档 */}
        <Box w="min(460px, 42vw)">
          <Flex align="center" mb={2} px={3}>
            <Text fontSize="xs" color="fg.muted" letterSpacing="wider">
              {t("misc.recentFiles")}
            </Text>
            <Button
              ms="auto"
              aria-label={t("misc.clearRecent")}
              title={t("misc.clearRecent")}
              variant="ghost"
              size="xs"
              h="20px"
              px={2}
              color="fg.muted"
              _hover={{ color: "fg", bg: "bg.subtle" }}
              onClick={() => clearRecents()}
            >
              {t("misc.clear")}
            </Button>
          </Flex>
          <Box position="relative">
            <VStack
              ref={recentListRef}
              className="no-scrollbar"
              gap={1}
              align="stretch"
              maxH="58vh"
              overflowY="auto"
              // 右侧留出悬浮滚动条的宽度,避免与时间文字重叠。
              pr={5}
            >
              {recents.map((f: RecentFile) => (
                <Flex
                  key={f.path}
                  align="center"
                  gap={3}
                  px={3}
                  py={2}
                  borderRadius="8px"
                  cursor="pointer"
                  transition="background 0.15s"
                  _hover={{ bg: "bg.subtle" }}
                  // 悬停时:时间隐藏,删除按钮显现(纯 CSS,确保可靠)。
                  css={{
                    "&:hover .recent-time": { display: "none" },
                    "&:hover .recent-remove": { display: "inline-flex" },
                  }}
                  onClick={() => void openStandaloneFiles([f.path])}
                >
                  <FileText size={18} color="var(--chakra-colors-fg-muted)" style={{ flexShrink: 0 }} />
                  <Box flex={1} minW={0}>
                    <Text fontSize="sm" fontWeight="medium" truncate>
                      {f.name}
                    </Text>
                    <Text fontSize="xs" color="fg.muted" truncate>
                      {dirOf(f.path)}
                    </Text>
                  </Box>
                  <Text className="recent-time" fontSize="xs" color="fg.muted" flexShrink={0}>
                    {formatTs(f.ts)}
                  </Text>
                  <IconButton
                    className="recent-remove"
                    aria-label={t("misc.removeFromList", { name: f.name })}
                    title={t("misc.remove")}
                    variant="ghost"
                    size="xs"
                    flexShrink={0}
                    display="none"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRecent(f.path);
                    }}
                  >
                    <X size={14} />
                  </IconButton>
                </Flex>
              ))}
            </VStack>
            <FloatingScrollbar targetRef={recentListRef} />
          </Box>
        </Box>
      </Flex>
      {settingsModal}
    </Box>
  );
}
