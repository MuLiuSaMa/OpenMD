import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, Flex } from "@chakra-ui/react";
import { FolderOpen, ListTree } from "lucide-react";
import { useSettings, type SidebarTab } from "../stores/settings";
import { useWorkspace } from "../stores/workspace";
import { openFolderDialog } from "../tauri/api";
import { TocPanel } from "./TocSidebar";
import { WorkspaceTree } from "./WorkspaceTree";

function TabButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Box
      as="button"
      display="flex"
      alignItems="center"
      gap={1}
      fontSize="xs"
      px={2}
      py={1}
      borderRadius="sm"
      cursor="pointer"
      color={active ? "fg" : "fg.muted"}
      bg={active ? "bg.subtle" : "transparent"}
      fontWeight={active ? "medium" : "normal"}
      _hover={{ color: "fg", bg: "bg.subtle" }}
      onClick={onClick}
    >
      {icon}
      <Box as="span">{label}</Box>
    </Box>
  );
}

/**
 * 统一侧栏:250px 占位宽度过渡(原 TocSidebar 范式),顶部小 Tab 在
 * 「文件夹」(工作区目录树)与「目录」(当前文档大纲)之间切换。两个 Tab
 * 独立工作:没打开工作区时文件夹 Tab 显示引导按钮,目录 Tab 始终可用。
 */
export function Sidebar({ open }: { open: boolean }) {
  const { t } = useTranslation();
  const sidebarTab = useSettings((s) => s.sidebarTab);
  const setSidebarTab = useSettings((s) => s.setSidebarTab);

  const handleOpenFolder = async () => {
    const picked = await openFolderDialog().catch(() => null);
    if (picked) await useWorkspace.getState().openFolder(picked);
  };

  const tabs: { key: SidebarTab; label: string; icon: ReactNode }[] = [
    { key: "files", label: t("shell.workspace"), icon: <FolderOpen size={13} /> },
    { key: "toc", label: t("shell.toc"), icon: <ListTree size={13} /> },
  ];

  return (
    // 常驻挂载,通过宽度过渡实现展开/收起动画;收起时隐藏右边框。
    <Box
      w={open ? "250px" : "0px"}
      flexShrink={0}
      borderRightWidth="1px"
      borderColor={open ? "border.subtle" : "transparent"}
      position="relative"
      overflow="hidden"
      transition="width 0.25s ease, border-color 0.25s ease"
      _motionReduce={{ transition: "none" }}
    >
      <Flex w="250px" h="100%" direction="column">
        <Flex gap={1} px={2} pt={2} pb={1} flexShrink={0}>
          {tabs.map((tab) => (
            <TabButton
              key={tab.key}
              active={sidebarTab === tab.key}
              label={tab.label}
              icon={tab.icon}
              onClick={() => setSidebarTab(tab.key)}
            />
          ))}
        </Flex>
        <Box flex={1} minH={0}>
          {sidebarTab === "toc" ? (
            <TocPanel />
          ) : (
            <WorkspaceTree onOpenFolder={() => void handleOpenFolder()} />
          )}
        </Box>
      </Flex>
    </Box>
  );
}
