import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Grid, HStack, IconButton, Input, Separator } from "@chakra-ui/react";
import { useTheme } from "next-themes";
import { FolderOpen, Minus, Moon, PanelLeft, Plus, Settings, StretchHorizontal, Sun } from "lucide-react";
import { useSettings } from "../stores/settings";
import { openFileDialog } from "../tauri/api";
import { useTabs } from "../stores/tabs";
import { withViewTransition } from "../utils/viewTransition";
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
  const { fontSize, setFontSize, tocOpen, toggleToc, fullWidth, toggleFullWidth } = useSettings();
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

  const handleOpen = async () => {
    try {
      const paths = await openFileDialog();
      for (const p of paths ?? []) {
        await openPaths(p);
      }
    } catch (e) {
      onOpenError?.(String(e));
    }
  };

  // 三列网格:左 Logo、中功能、右窗口控制,保证功能组在窗口中真正居中。
  // 去原生标题栏后,整条顶栏都是拖拽区(data-tauri-drag-region);
  // 按钮自身不带该属性,点击不受影响。双击拖拽区可最大化/还原。
  return (
    <Box
      as="header"
      h="46px"
      px={4}
      paddingLeft="3px"
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
          <Button
            aria-label={t("shell.openFileShortcut")}
            title={t("shell.openFileShortcut")}
            variant="ghost"
            size="sm"
            gap={1.5}
            onClick={handleOpen}
          >
            <FolderOpen size={15} />
            {t("shell.openFile")}
          </Button>

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
            variant={tocOpen ? "subtle" : "ghost"}
            size="sm"
            gap={1.5}
            onClick={toggleToc}
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
