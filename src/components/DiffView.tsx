import { useMemo } from "react";
import { Box, Button, Flex, HStack, Text } from "@chakra-ui/react";
import { X } from "lucide-react";
import { useTheme } from "next-themes";
import { computeSideBySideDiff, type DiffLineKind } from "../renderer/lineDiff";

function cellBg(kind: DiffLineKind, isDark: boolean): string {
  if (kind === "add") {
    return isDark ? "rgba(46, 160, 67, 0.18)" : "rgba(46, 160, 67, 0.14)";
  }
  if (kind === "remove") {
    return isDark ? "rgba(248, 81, 73, 0.18)" : "rgba(248, 81, 73, 0.13)";
  }
  if (kind === "empty") {
    return isDark ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 0, 0, 0.025)";
  }
  return "transparent";
}

function markerChar(kind: DiffLineKind): string {
  if (kind === "add") return "+";
  if (kind === "remove") return "-";
  return " ";
}

function markerColor(kind: DiffLineKind, isDark: boolean): string {
  if (kind === "add") return isDark ? "#3fb950" : "#1a7f37";
  if (kind === "remove") return isDark ? "#f85149" : "#cf222e";
  return "transparent";
}

export function DiffView({
  leftTitle,
  leftText,
  rightTitle,
  rightText,
  onCloseDiff,
}: {
  leftTitle: string;
  leftText: string;
  rightTitle: string;
  rightText: string;
  onCloseDiff?: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  const { rows, added, removed } = useMemo(
    () => computeSideBySideDiff(leftText, rightText),
    [leftText, rightText],
  );

  const fontFamily =
    '"JetBrains Mono", "JetbrainsMono", "Microsoft YaHei", "微软雅黑", monospace';

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
          {rightTitle}
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

      <Box
        flex={1}
        minH={0}
        overflow="auto"
        fontSize="13px"
        lineHeight="1.6"
        style={{ fontFamily }}
      >
        {rows.length === 0 ? (
          <Flex h="100%" align="center" justify="center" color="fg.muted" fontSize="sm">
            无内容差异
          </Flex>
        ) : (
          <Box minW="fit-content">
            {rows.map((r, idx) => (
              <Flex
                key={idx}
                borderBottomWidth="1px"
                borderColor={isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)"}
              >
                {/* 左侧 */}
                <Flex
                  flex={1}
                  minW="240px"
                  bg={cellBg(r.leftKind, isDark)}
                  borderRightWidth="1px"
                  borderColor="border.subtle"
                >
                  <Box
                    w="44px"
                    flexShrink={0}
                    px={2}
                    textAlign="right"
                    color="fg.subtle"
                    userSelect="none"
                    fontSize="11px"
                  >
                    {r.leftLine ?? ""}
                  </Box>
                  <Box
                    w="16px"
                    flexShrink={0}
                    textAlign="center"
                    userSelect="none"
                    color={markerColor(r.leftKind, isDark)}
                  >
                    {markerChar(r.leftKind)}
                  </Box>
                  <Box
                    flex={1}
                    pr={3}
                    whiteSpace="pre-wrap"
                    wordBreak="break-word"
                  >
                    {r.leftText || " "}
                  </Box>
                </Flex>

                {/* 右侧 */}
                <Flex flex={1} minW="240px" bg={cellBg(r.rightKind, isDark)}>
                  <Box
                    w="44px"
                    flexShrink={0}
                    px={2}
                    textAlign="right"
                    color="fg.subtle"
                    userSelect="none"
                    fontSize="11px"
                  >
                    {r.rightLine ?? ""}
                  </Box>
                  <Box
                    w="16px"
                    flexShrink={0}
                    textAlign="center"
                    userSelect="none"
                    color={markerColor(r.rightKind, isDark)}
                  >
                    {markerChar(r.rightKind)}
                  </Box>
                  <Box
                    flex={1}
                    pr={3}
                    whiteSpace="pre-wrap"
                    wordBreak="break-word"
                  >
                    {r.rightText || " "}
                  </Box>
                </Flex>
              </Flex>
            ))}
          </Box>
        )}
      </Box>
    </Flex>
  );
}
