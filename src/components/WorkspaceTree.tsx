import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { useTabs } from "../stores/tabs";
import { useWorkspace } from "../stores/workspace";
import { FloatingScrollbar } from "./FloatingScrollbar";

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

interface RowProps {
  name: string;
  depth: number;
  isDir: boolean;
  expanded?: boolean;
  active?: boolean;
  onClick: () => void;
}

/** 树的一行:缩进 + 折叠箭头/类型图标 + 名称。黑白极简,活动项 subtle 底。 */
function Row({ name, depth, isDir, expanded, active, onClick }: RowProps) {
  return (
    <Box
      as="button"
      display="flex"
      alignItems="center"
      gap={1}
      textAlign="start"
      fontSize="xs"
      lineHeight="1.4"
      py={0.5}
      pl={`${depth * 14 + 6}px`}
      pr={2}
      borderRadius="sm"
      cursor="pointer"
      color={active ? "fg" : "fg.muted"}
      bg={active ? "bg.subtle" : "transparent"}
      textOverflow="ellipsis"
      overflow="hidden"
      whiteSpace="nowrap"
      _hover={{ color: "fg", bg: "bg.subtle" }}
      onClick={onClick}
      title={name}
    >
      {isDir ? (
        expanded ? (
          <ChevronDown size={12} style={{ flexShrink: 0 }} />
        ) : (
          <ChevronRight size={12} style={{ flexShrink: 0 }} />
        )
      ) : null}
      {isDir ? (
        <Folder size={13} style={{ flexShrink: 0 }} />
      ) : (
        <FileText size={13} style={{ flexShrink: 0 }} />
      )}
      <Box as="span" truncate>
        {name}
      </Box>
    </Box>
  );
}

/**
 * 工作区目录树:根目录 + 懒加载一层层展开的子目录。文件点击走 tabs 的
 * openPath(打开成标签页,工作区上下文不动);活动文件跟随当前标签高亮。
 * 未打开工作区时显示引导按钮。浏览器预览环境没有文件 IO,树保持为空。
 */
export function WorkspaceTree({ onOpenFolder }: { onOpenFolder: () => void }) {
  const { t } = useTranslation();
  const root = useWorkspace((s) => s.root);
  const expanded = useWorkspace((s) => s.expanded);
  const children = useWorkspace((s) => s.children);
  const toggleDir = useWorkspace((s) => s.toggleDir);
  const ensureLoaded = useWorkspace((s) => s.ensureLoaded);
  const openPath = useTabs((s) => s.openPath);
  const activePath = useTabs((s) => s.tabs.find((x) => x.id === s.activeId)?.path ?? null);
  const listRef = useRef<HTMLDivElement>(null);

  // 直接切到文件 Tab(未经过 openFolder,比如启动恢复)时补一次根加载
  useEffect(() => {
    if (root) void ensureLoaded(root);
  }, [root, ensureLoaded]);

  if (!root) {
    return (
      <VStack gap={3} px={4} py={10} align="center">
        <FolderOpen size={22} color="var(--chakra-colors-fg-faint)" />
        <Text fontSize="xs" color="fg.faint" textAlign="center" lineHeight="1.6">
          {t("shell.workspaceEmpty")}
        </Text>
        <Button
          size="xs"
          variant="outline"
          borderColor="fg.muted"
          color="fg"
          borderRadius="6px"
          _hover={{ bg: "fg", color: "bg", borderColor: "fg" }}
          onClick={onOpenFolder}
        >
          <FolderOpen size={13} />
          {t("shell.openFolder")}
        </Button>
      </VStack>
    );
  }

  const renderNodes = (dir: string, depth: number): ReactNode[] => {
    const entries = children.get(dir);
    if (!entries) return [];
    const nodes: ReactNode[] = [];
    for (const entry of entries) {
      if (entry.is_dir) {
        const isOpen = expanded.has(entry.path);
        nodes.push(
          <Box key={entry.path}>
            <Row
              name={entry.name}
              depth={depth}
              isDir
              expanded={isOpen}
              onClick={() => void toggleDir(entry.path)}
            />
            {isOpen && renderNodes(entry.path, depth + 1)}
          </Box>,
        );
      } else {
        nodes.push(
          <Row
            key={entry.path}
            name={entry.name}
            depth={depth}
            isDir={false}
            active={entry.path === activePath}
            onClick={() => void openPath(entry.path)}
          />,
        );
      }
    }
    return nodes;
  };

  return (
    <Box position="relative" h="100%">
      <Box
        ref={listRef}
        className="no-scrollbar"
        h="100%"
        overflowY="auto"
        px={2}
        py={2}
        as="nav"
        aria-label={t("shell.workspace")}
      >
        <Row
          name={baseName(root)}
          depth={0}
          isDir
          expanded
          active={root === activePath}
          onClick={() => void toggleDir(root)}
        />
        {expanded.has(root) && renderNodes(root, 1)}
        {/* 目录读取成功但里面既没有子目录也没有文档:明说一句,别让用户对着一片空白。
            (读取失败时 children 里没有这个 key,不显示提示,免得误报"空文件夹"。) */}
        {children.get(root)?.length === 0 && (
          <Text fontSize="xs" color="fg.faint" px={3} py={2}>
            {t("shell.workspaceNoFiles")}
          </Text>
        )}
      </Box>
      <FloatingScrollbar targetRef={listRef} />
    </Box>
  );
}
