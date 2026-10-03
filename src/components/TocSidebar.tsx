import { useRef } from "react";
import { Box, Text, VStack } from "@chakra-ui/react";
import { setActiveHeading, useToc } from "../stores/toc";
import { FloatingScrollbar } from "./FloatingScrollbar";

export function TocSidebar({ open }: { open: boolean }) {
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
      <Box
        ref={listRef}
        className="no-scrollbar"
        w="250px"
        h="100%"
        overflowY="auto"
        px={2}
        py={3}
        as="nav"
        aria-label="目录"
      >
        {entries.length === 0 ? (
          <Text fontSize="sm" color="fg.faint" px={2}>
            无标题
          </Text>
        ) : (
          list
        )}
      </Box>
      <FloatingScrollbar targetRef={listRef} />
    </Box>
  );
}
