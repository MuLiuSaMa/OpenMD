import { HStack, Text } from "@chakra-ui/react";
import { useTabs } from "../stores/tabs";
import { useToc } from "../stores/toc";

export function StatusBar() {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const entries = useToc((s) => s.entries);
  const tab = tabs.find((t) => t.id === activeId);

  if (!tab) return null;

  const wordCount = tab.path
    ? tab.content.trim().split(/\s+/).filter(Boolean).length
    : 0;
  const charCount = tab.path ? tab.content.length : 0;

  return (
    <HStack
      as="footer"
      h="26px"
      px={3}
      gap={4}
      flexShrink={0}
      borderTopWidth="1px"
      borderColor="border.subtle"
      bg="bg.subtle"
      fontSize="2xs"
      color="fg.muted"
      userSelect="none"
    >
      <Text truncate maxW="45%">
        {tab.path ?? "OpenMD"}
      </Text>
      {tab.diskChanged && <Text color="orange.400">文件已在磁盘上修改</Text>}
      {tab.path && (
        <>
          <Text>{wordCount} 词</Text>
          <Text>{charCount} 字符</Text>
          <Text>{entries.length} 个标题</Text>
        </>
      )}
      <Text ms="auto" color="fg.faint">
        {tab.error ? "打开失败" : "作者：木流"}
      </Text>
    </HStack>
  );
}
