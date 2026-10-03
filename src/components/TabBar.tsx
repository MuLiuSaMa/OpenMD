import { Box, HStack, IconButton, Text } from "@chakra-ui/react";
import { X } from "lucide-react";
import { HOME_TAB_ID, useTabs } from "../stores/tabs";

export function TabBar() {
  const { tabs, activeId, setActive, closeTab } = useTabs();

  return (
    <HStack
      as="nav"
      gap={0}
      px={2}
      pt={1}
      flexShrink={0}
      overflowX="auto"
      overflowY="hidden"
      borderBottomWidth="1px"
      borderColor="border.subtle"
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
                closeTab(tab.id);
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
            title={tab.path ?? tab.name}
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
            <Text as="span" truncate>
              {tab.name}
            </Text>
            {tab.id !== HOME_TAB_ID && (
              <IconButton
                aria-label="关闭标签"
                size="2xs"
                variant="ghost"
                flexShrink={0}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <X size={12} />
              </IconButton>
            )}
          </Box>
        );
      })}
    </HStack>
  );
}
