import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Box, Flex } from "@chakra-ui/react";
import { Check } from "lucide-react";

/**
 * Content-area context menu: a floating list anchored at the cursor,
 * replacing the WebView2 default menu (which is suppressed globally in
 * App.tsx). A full-screen transparent capture layer closes it on any click —
 * same pattern as the vendored reference project's TabBar menu.
 */

export interface MenuItemDef {
  type: "item";
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Trailing hint text (e.g. a ratio or shortcut), muted. */
  hint?: string;
  /** 当前默认项:右侧显示 ✓(如“用其他程序打开”菜单里的上次选择)。 */
  active?: boolean;
  /** 点击后不关闭菜单(如“用其他程序打开”:连续切换试不同程序)。 */
  keepOpen?: boolean;
  onClick: () => void;
}

/** A row the host renders itself (e.g. the custom-width input). */
export interface MenuCustomDef {
  type: "custom";
  node: ReactNode;
}

export type MenuEntry = MenuItemDef | MenuCustomDef | { type: "sep" };

interface ContextMenuProps {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose: () => void;
}

const MENU_WIDTH = 208;
const ITEM_HEIGHT = 30;

export function ContextMenu({ x, y, entries, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef({ x, y });

  // Clamp to the viewport once the real height is known.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = Math.max(4, Math.min(posRef.current.x, window.innerWidth - rect.width - 4));
    const ny = Math.max(4, Math.min(posRef.current.y, window.innerHeight - rect.height - 4));
    el.style.left = `${nx}px`;
    el.style.top = `${ny}px`;
  }, [entries]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <Box
      position="fixed"
      inset="0"
      zIndex={90}
      // 捕获层:任意点击/右键都只是关闭菜单。
      onMouseDown={(e) => {
        e.preventDefault();
        onClose();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
      onWheel={() => onClose()}
    >
      <Flex
        ref={menuRef}
        direction="column"
        position="fixed"
        minW={`${MENU_WIDTH}px`}
        borderRadius="8px"
        borderWidth="1px"
        borderColor="border.subtle"
        bg="bg.panel"
        boxShadow="md"
        backdropFilter="blur(8px)"
        py={1}
        maxHeight="70vh"
        overflowY="auto"
        css={{
          "&::-webkit-scrollbar": { width: "8px" },
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        {entries.map((entry, i) =>
          entry.type === "sep" ? (
            <Box key={i} my={1} h="1px" bg="border.subtle" />
          ) : entry.type === "custom" ? (
            <Box key={i} onClick={(e) => e.stopPropagation()}>
              {entry.node}
            </Box>
          ) : (
            <Box
              key={i}
              as="button"
              // 阻止 mousedown 默认行为:点击菜单项不转移焦点、不清掉正文选区,
              // 加粗/剪切/复制这类依赖选区的操作才能生效。
              onMouseDown={(e) => e.preventDefault()}
              display="flex"
              alignItems="center"
              gap={2}
              px={3}
              h={`${ITEM_HEIGHT}px`}
              fontSize="xs"
              textAlign="start"
              w="100%"
              color={entry.disabled ? "fg.subtle" : "fg"}
              cursor={entry.disabled ? "default" : "pointer"}
              userSelect="none"
              _hover={entry.disabled ? {} : { bg: "bg.subtle" }}
              onClick={() => {
                if (entry.disabled) return;
                if (!entry.keepOpen) onClose();
                entry.onClick();
              }}
            >
              {entry.icon && <Flex flexShrink={0} aria-hidden>{entry.icon}</Flex>}
              <Box as="span" flex={1} truncate>
                {entry.label}
              </Box>
              {entry.hint && (
                <Box as="span" ms="auto" fontSize="2xs" color="fg.subtle">
                  {entry.hint}
                </Box>
              )}
              {entry.active && !entry.hint && <Check size={14} aria-hidden />}
            </Box>
          ),
        )}
      </Flex>
    </Box>
  );
}
