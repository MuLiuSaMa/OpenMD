import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Box, Text, VStack } from "@chakra-ui/react";
import { setActiveHeading, useToc } from "../stores/toc";
import { FloatingScrollbar } from "./FloatingScrollbar";

/**
 * 统一侧栏的「目录」Tab 内容:当前文档的标题大纲。
 * (外层的宽度过渡动画与 Tab 切换在 Sidebar.tsx。)
 */
export function TocPanel() {
  const { t } = useTranslation();
  const { entries, activeId } = useToc();
  const listRef = useRef<HTMLDivElement>(null);

  const minLevel = entries.length > 0 ? Math.min(...entries.map((e) => e.level)) : 1;

  const list = (
    <VStack gap={0} align="stretch">
      {entries.map((entry) => {
        const active = entry.id === activeId;
        return (
          <Box
            key={`${entry.level}-${entry.id}`}
            as="button"
            textAlign="start"
            fontSize={entry.level === minLevel ? "sm" : "xs"}
            fontWeight={entry.level <= minLevel + 1 ? "medium" : "normal"}
            lineHeight="1.4"
            py={1}
            pl={`${(entry.level - minLevel) * 12 + 8}px`}
            pr={2}
            borderRadius="sm"
            cursor="pointer"
            color={active ? "colorPalette.solid" : "fg.muted"}
            bg={active ? "colorPalette.subtle" : "transparent"}
            textOverflow="ellipsis"
            overflow="hidden"
            whiteSpace="nowrap"
            _hover={{ color: "fg", bg: "bg.subtle" }}
            onClick={() => {
              setActiveHeading(entry.id);
              document.getElementById(entry.id)?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            }}
            title={entry.text}
          >
            {entry.text}
          </Box>
        );
      })}
    </VStack>
  );

  return (
    // 悬浮滚动条是滚动元素的兄弟节点:宿主 position:relative,滚动元素自身
    // 挂 no-scrollbar,由 FloatingScrollbar 叠加绘制。
    <Box position="relative" w="250px" h="100%">
      <Box
        ref={listRef}
        className="no-scrollbar"
        w="250px"
        h="100%"
        overflowY="auto"
        px={2}
        py={3}
        as="nav"
        aria-label={t("shell.toc")}
      >
        {entries.length === 0 ? (
          <Text fontSize="sm" color="fg.faint" px={2}>
            {t("shell.noHeadings")}
          </Text>
        ) : (
          list
        )}
      </Box>
      <FloatingScrollbar targetRef={listRef} />
    </Box>
  );
}
