import { useTranslation } from "react-i18next";
import { HStack, Text } from "@chakra-ui/react";
import { isDirty, useTabs } from "../stores/tabs";
import { useToc } from "../stores/toc";
import { IS_STORE_BUILD } from "../lib/build-flags";

export function StatusBar() {
  const { t } = useTranslation();
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const entries = useToc((s) => s.entries);
  const tab = tabs.find((t) => t.id === activeId);

  if (!tab) return null;

  // 编辑中的字数统计跟随草稿,保存后归位到 content。
  const shown = tab.draft ?? tab.content;
  const wordCount = tab.path ? shown.trim().split(/\s+/).filter(Boolean).length : 0;
  const charCount = tab.path ? shown.length : 0;

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
      {tab.diskChanged && <Text color="orange.400">{t("shell.fileChangedOnDisk")}</Text>}
      {isDirty(tab) && <Text color="fg">{t("shell.unsaved")}</Text>}
      {tab.path && (
        <>
          <Text>{t("shell.wordCount", { count: wordCount })}</Text>
          <Text>{t("shell.charCount", { count: charCount })}</Text>
          <Text>{t("shell.headingCount", { count: entries.length })}</Text>
        </>
      )}
      {/* 商店版不展示作者文案;出错提示保留 */}
      {(!IS_STORE_BUILD || tab.error) && (
        <Text ms="auto" color="fg.faint">
          {tab.error ? t("shell.openFailed") : t("shell.author")}
        </Text>
      )}
    </HStack>
  );
}
