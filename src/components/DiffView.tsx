import { useMemo, useRef } from "react";
import { Box, Button, Flex, HStack, Text } from "@chakra-ui/react";
import { X } from "lucide-react";
import { useTheme } from "next-themes";
import { computeSideLineDiff } from "../renderer/lineDiff";

function rowBg(kind: "equal" | "add" | "remove", isDark: boolean): string {
  if (kind === "add") {
    return isDark ? "rgba(46, 160, 67, 0.2)" : "rgba(46, 160, 67, 0.14)";
  }
  if (kind === "remove") {
    return isDark ? "rgba(248, 81, 73, 0.2)" : "rgba(248, 81, 73, 0.13)";
  }
  return "transparent";
}

export function DiffView({
  leftTitle,
  leftText,
  rightTitle,
  rightText,
  onRightChange,
  onCloseDiff,
}: {
  leftTitle: string;
  leftText: string;
  rightTitle: string;
  rightText: string;
  onRightChange?: (next: string) => void;
  onCloseDiff?: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  const { leftLines, rightLines, added, removed } = useMemo(
    () => computeSideLineDiff(leftText, rightText),
    [leftText, rightText],
  );

  const fontFamily =
    '"JetBrains Mono", "JetbrainsMono", "Microsoft YaHei", "微软雅黑", monospace';

  const syncScroll = (from: "left" | "right") => {
    if (syncingRef.current) return;
    const src = from === "left" ? leftScrollRef.current : rightScrollRef.current;
    const dst = from === "left" ? rightScrollRef.current : leftScrollRef.current;
    if (!src || !dst) return;
    syncingRef.current = true;
    dst.scrollTop = src.scrollTop;
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  };

  return (
    <Flex direction="column" flex={1} minW={0} minH={0} bg="bg.canvas">
      <HStack
        h="34px"
        px={3}
        gap={3}
        flexShrink={0}
        borderBottomWidth="1px"
        borderColor="border.subtle"
        bg="bg.subtle"
        fontSize="xs"
      >
        <Text fontWeight="medium" truncate flex={1} minW={0} title={leftTitle}>
          {leftTitle}
        </Text>
        <HStack gap={2} flexShrink={0}>
          <Text color={isDark ? "#3fb950" : "#1a7f37"} fontWeight="medium">
            +{added}
          </Text>
          <Text color={isDark ? "#f85149" : "#cf222e"} fontWeight="medium">
            -{removed}
          </Text>
        </HStack>
        <Text fontWeight="medium" truncate flex={1} minW={0} textAlign="right" title={rightTitle}>
          {rightTitle} {onRightChange ? "(可编辑)" : ""}
        </Text>
        {onCloseDiff && (
          <Button
            size="2xs"
            variant="ghost"
            px={1.5}
            title="退出 Diff"
            onClick={onCloseDiff}
          >
            <X size={13} />
          </Button>
        )}
      </HStack>

      <Flex flex={1} minW={0} minH={0}>
        {/* 左侧只读对照区 */}
        <Box
          ref={leftScrollRef}
          flex={1}
          minW={0}
          minH={0}
          overflowY="auto"
          borderRightWidth="1px"
          borderColor="border.subtle"
          fontSize="13px"
          lineHeight="1.65"
          style={{ fontFamily }}
          onScroll={() => syncScroll("left")}
        >
          <Box py={3}>
            {leftLines.map((l) => (
              <Flex key={l.line} bg={rowBg(l.kind, isDark)} px={2}>
                <Box
                  w="38px"
                  flexShrink={0}
                  pr={2}
                  textAlign="right"
                  color="fg.subtle"
                  userSelect="none"
                  fontSize="11px"
                >
                  {l.line}
                </Box>
                <Box
                  w="14px"
                  flexShrink={0}
                  textAlign="center"
                  userSelect="none"
                  color={l.kind === "remove" ? (isDark ? "#f85149" : "#cf222e") : "transparent"}
                >
                  {l.kind === "remove" ? "-" : " "}
                </Box>
                <Box flex={1} minW={0} whiteSpace="pre-wrap" wordBreak="break-word">
                  {l.text || "\u00A0"}
                </Box>
              </Flex>
            ))}
          </Box>
        </Box>

        {/* 右侧可编辑对照区：高亮底层与透明 textarea 网格叠放 */}
        <Box
          ref={rightScrollRef}
          flex={1}
          minW={0}
          minH={0}
          overflowY="auto"
          fontSize="13px"
          lineHeight="1.65"
          style={{ fontFamily }}
          onScroll={() => syncScroll("right")}
        >
          <Box display="grid" minH="100%">
            {/* 底层：行号、+ 标记与绿色高亮背景 */}
            <Box gridArea="1 / 1" py={3} pointerEvents="none">
              {rightLines.map((l) => (
                <Flex key={l.line} bg={rowBg(l.kind, isDark)} px={2}>
                  <Box
                    w="38px"
                    flexShrink={0}
                    pr={2}
                    textAlign="right"
                    color="fg.subtle"
                    userSelect="none"
                    fontSize="11px"
                  >
                    {l.line}
                  </Box>
                  <Box
                    w="14px"
                    flexShrink={0}
                    textAlign="center"
                    userSelect="none"
                    color={l.kind === "add" ? (isDark ? "#3fb950" : "#1a7f37") : "transparent"}
                  >
                    {l.kind === "add" ? "+" : " "}
                  </Box>
                  <Box
                    flex={1}
                    minW={0}
                    whiteSpace="pre-wrap"
                    wordBreak="break-word"
                    color="fg"
                  >
                    {l.text || "\u00A0"}
                  </Box>
                </Flex>
              ))}
            </Box>

            {/* 顶层：可编辑透明 textarea，左偏移 60px 对齐正文列（px:8px + w:38px + w:14px） */}
            {onRightChange && (
              <textarea
                aria-label="Diff 右侧编辑区"
                value={rightText}
                spellCheck={false}
                onChange={(e) => onRightChange(e.target.value)}
                style={{
                  gridArea: "1 / 1",
                  margin: 0,
                  padding: "12px 8px 12px 60px",
                  border: 0,
                  background: "transparent",
                  color: "transparent",
                  caretColor: isDark ? "#e6e6e6" : "#1f2328",
                  fontFamily,
                  fontSize: "13px",
                  lineHeight: "1.65",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  overflow: "hidden",
                  resize: "none",
                  outline: "none",
                  zIndex: 1,
                }}
              />
            )}
          </Box>
        </Box>
      </Flex>
    </Flex>
  );
}
