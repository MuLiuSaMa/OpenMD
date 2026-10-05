import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, HStack, IconButton, Text } from "@chakra-ui/react";
import { AppWindow, ChevronDown, FolderOpen, X } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { HOME_TAB_ID, isDirty, tabName, useTabs } from "../stores/tabs";
import { detectEditors, openFileWith, type EditorApp } from "../tauri/api";
import { ContextMenu, type MenuEntry } from "./ContextMenu";
import folderExplorerIcon from "../assets/folder-explorer.png";

/** 上次选择的打开方式(localStorage),主按钮与菜单 ✓ 共用。 */
const LAST_OPEN_KEY = "openmd.openWith.last";

/** 主按钮记住的选择:某个程序,或资源管理器。 */
interface OpenWithSelection {
  kind: "editor" | "explorer";
  /** kind === "editor" 时的 exe 路径、显示名与图标 data URL。 */
  exe?: string;
  name?: string;
  icon?: string | null;
}

function loadSelection(): OpenWithSelection | null {
  try {
    const raw = localStorage.getItem(LAST_OPEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OpenWithSelection;
    if (parsed?.kind === "explorer") return parsed;
    if (parsed?.kind === "editor" && parsed.exe && parsed.name) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** 程序图标:优先真实提取的图标,失败回退通用窗口图标。 */
function EditorIcon({ icon, size = 16 }: { icon?: string | null; size?: number }) {
  if (icon) {
    return (
      <img
        src={icon}
        alt=""
        draggable={false}
        style={{ width: size, height: size, borderRadius: 3, flexShrink: 0 }}
      />
    );
  }
  return <AppWindow size={size - 2} aria-hidden />;
}

/** 资源管理器图标(经典黄蓝文件夹)。 */
function ExplorerIcon({ size = 16 }: { size?: number }) {
  return (
    <img
      src={folderExplorerIcon}
      alt=""
      draggable={false}
      style={{ width: size, height: size, flexShrink: 0 }}
    />
  );
}

export function TabBar() {
  const { t } = useTranslation();
  const { tabs, activeId, setActive, requestCloseTab } = useTabs();
  // 菜单只存位置与数据,条目每次渲染时用最新 selection 重建,
  // 这样 keepOpen 下点选后 ✓ 与主按钮实时跟随。
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [menuEditors, setMenuEditors] = useState<EditorApp[] | null>(null);
  const [selection, setSelection] = useState<OpenWithSelection | null>(loadSelection);
  const chevronRef = useRef<HTMLButtonElement | null>(null);

  const activeTab = tabs.find((t) => t.id === activeId);
  const hasFile = !!activeTab?.path;

  const currentPath = () =>
    useTabs.getState().tabs.find((t) => t.id === useTabs.getState().activeId)?.path ?? null;

  const saveSelection = (sel: OpenWithSelection) => {
    setSelection(sel);
    localStorage.setItem(LAST_OPEN_KEY, JSON.stringify(sel));
  };

  /** 主按钮:用当前选择的程序/资源管理器打开;从未选择过则回退到资源管理器定位。 */
  const openWithDefault = async () => {
    const path = currentPath();
    if (!path) return;
    if (selection?.kind === "editor" && selection.exe) {
      try {
        await openFileWith(selection.exe, path);
        return;
      } catch (e) {
        console.error("上次使用的程序启动失败:", e);
      }
    }
    try {
      await revealItemInDir(path);
    } catch (e) {
      console.error("打开资源管理器失败:", e);
    }
  };

  /** 下拉:扫描系统里能打开 Markdown 的程序(.md 关联的在前),末位是
   *  文件资源管理器;当前选择打 ✓。选中任意一项后主按钮随之变化,
   *  菜单不关闭,可连续换程序试开(Esc/点外部关闭)。 */
  const openWithMenu = async () => {
    const path = currentPath();
    if (!path) return;
    const rect = chevronRef.current?.getBoundingClientRect();
    if (!rect) return;

    let editors: EditorApp[] = [];
    try {
      editors = await detectEditors();
    } catch (e) {
      console.error("扫描可打开的程序失败:", e);
    }
    setMenuEditors(editors);
    setMenuPos({ x: rect.left, y: rect.bottom + 4 });
  };

  const closeMenu = () => {
    setMenuPos(null);
    setMenuEditors(null);
  };

  const buildOpenWithEntries = (): MenuEntry[] => {
    const path = currentPath();
    const editors = menuEditors ?? [];
    const pickEditor = (ed: EditorApp) => () => {
      saveSelection({ kind: "editor", exe: ed.exe, name: ed.name, icon: ed.icon });
      if (path) {
        void openFileWith(ed.exe, path).catch((e) => console.error("用其他程序打开失败:", e));
      }
    };
    const pickExplorer = () => {
      saveSelection({ kind: "explorer" });
      if (path) {
        void revealItemInDir(path).catch((e) => console.error("打开资源管理器失败:", e));
      }
    };

    const entries: MenuEntry[] = [];
    if (editors.length === 0) {
      entries.push({ type: "item", label: t("tabs.openWith.noEditors"), disabled: true, onClick: () => {} });
    }
    entries.push(
      ...editors.map(
        (ed): MenuEntry => ({
          type: "item",
          label: ed.name,
          icon: <EditorIcon icon={ed.icon} />,
          active: selection?.kind === "editor" && selection.exe === ed.exe,
          keepOpen: true,
          onClick: pickEditor(ed),
        }),
      ),
    );
    entries.push(
      { type: "sep" },
      {
        type: "item",
        label: t("tabs.openWith.explorer"),
        icon: <ExplorerIcon size={16} />,
        active: selection?.kind === "explorer",
        keepOpen: true,
        onClick: pickExplorer,
      },
    );
    return entries;
  };

  // 主按钮外观跟随当前选择:未选择 → 打开(回退为资源管理器定位);
  // 资源管理器 / 某个程序 → 显示对应图标与名称。
  let mainIcon = <FolderOpen size={13} />;
  let mainLabel = t("tabs.openWith.open");
  let mainTitle = t("tabs.openWith.showInExplorer");
  if (selection?.kind === "explorer") {
    mainIcon = <ExplorerIcon size={14} />;
    mainLabel = t("tabs.openWith.explorerShort");
    mainTitle = t("tabs.openWith.showInExplorerShort");
  } else if (selection?.kind === "editor" && selection.name) {
    mainIcon = <EditorIcon icon={selection.icon} size={14} />;
    mainLabel = selection.name;
    mainTitle = t("tabs.openWith.openWithApp", { name: selection.name });
  }

  return (
    <Box
      as="nav"
      display="flex"
      alignItems="stretch"
      flexShrink={0}
      borderBottomWidth="1px"
      borderBottomColor="border.subtle"
    >
      <HStack
        gap={0}
        px={2}
        pt={1}
        flex={1}
        minW={0}
        overflowX="auto"
        overflowY="hidden"
        css={{
          "&::-webkit-scrollbar": { height: "0px" },
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <Box
              key={tab.id}
              as="button"
              onClick={() => setActive(tab.id)}
              // 阻止 WebView2 中键自动滚动,否则 auxclick 不触发、中键关闭失效。
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault();
              }}
              onAuxClick={(e) => {
                if (e.button === 1 && tab.id !== HOME_TAB_ID) {
                  e.preventDefault();
                  void requestCloseTab(tab.id);
                }
              }}
              px={3}
              py={1.5}
              borderTopRadius="md"
              fontSize="xs"
              display="flex"
              alignItems="center"
              gap={1.5}
              maxW="200px"
              flexShrink={0}
              cursor="pointer"
              userSelect="none"
              bg={active ? "bg.canvas" : "transparent"}
              color={active ? "fg" : "fg.muted"}
              borderBottomWidth="1px"
              borderBottomColor={active ? "transparent" : "border.subtle"}
              title={tab.path ?? tabName(tab)}
            >
              {tab.diskChanged && (
                <Box
                  as="span"
                  w={1.5}
                  h={1.5}
                  borderRadius="full"
                  bg="orange.400"
                  flexShrink={0}
                />
              )}
              {isDirty(tab) && (
                <Box
                  as="span"
                  w={1.5}
                  h={1.5}
                  borderRadius="full"
                  border="1.5px solid"
                  borderColor="fg"
                  flexShrink={0}
                  title={t("tabs.tab.unsavedChanges")}
                />
              )}
              <Text as="span" truncate>
                {tabName(tab)}
              </Text>
              {tab.id !== HOME_TAB_ID && (
                <IconButton
                  aria-label={t("tabs.tab.close")}
                  size="2xs"
                  variant="ghost"
                  flexShrink={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    void requestCloseTab(tab.id);
                  }}
                >
                  <X size={12} />
                </IconButton>
              )}
            </Box>
          );
        })}
      </HStack>
      {/* 最右侧固定的分体式“打开”:[当前选择 | ▾] 不随标签横向滚动。
          主段用当前选择打开,▾ 弹出程序菜单;选择后主段随之变化。 */}
      <Box display="flex" alignItems="center" flexShrink={0} px={2} pb={1}>
        <HStack
          gap={0}
          borderWidth="1px"
          borderColor="border.subtle"
          borderRadius="7px"
          overflow="hidden"
          bg="bg.panel"
        >
          <Box
            as="button"
            display="flex"
            alignItems="center"
            gap={1.5}
            px={2}
            h="24px"
            fontSize="xs"
            color="fg"
            userSelect="none"
            cursor={hasFile ? "pointer" : "default"}
            _hover={hasFile ? { bg: "bg.subtle" } : {}}
            opacity={hasFile ? 1 : 0.45}
            title={mainTitle}
            onClick={() => {
              if (hasFile) void openWithDefault();
            }}
          >
            {mainIcon}
            <Text as="span" maxW="110px" truncate>
              {mainLabel}
            </Text>
          </Box>
          <Box w="1px" alignSelf="stretch" my="3px" bg="border.subtle" flexShrink={0} />
          <Box
            ref={chevronRef}
            as="button"
            display="flex"
            alignItems="center"
            px={1.5}
            h="24px"
            color="fg.muted"
            userSelect="none"
            cursor={hasFile ? "pointer" : "default"}
            _hover={hasFile ? { bg: "bg.subtle" } : {}}
            opacity={hasFile ? 1 : 0.45}
            aria-label={t("tabs.openWith.chooseOther")}
            title={t("tabs.openWith.chooseOther")}
            onClick={() => {
              if (hasFile) void openWithMenu();
            }}
          >
            <ChevronDown size={13} />
          </Box>
        </HStack>
      </Box>
      {menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          entries={buildOpenWithEntries()}
          onClose={closeMenu}
        />
      )}
    </Box>
  );
}
