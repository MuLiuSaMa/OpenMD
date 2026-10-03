import { useRef } from "react";
import { Box, Button, HStack, IconButton, Text } from "@chakra-ui/react";
import { Download, RefreshCw, X } from "lucide-react";
import { viewInAnimation } from "../theme/theme";
import { FloatingScrollbar } from "./FloatingScrollbar";
import { useUpdate } from "../stores/update";

/**
 * 新版本更新小弹窗(固定右下角),与关于页的检查更新共用同一个 store:
 * 提示(下载/取消) → 下载中(进度条/取消) → 下载完成(重启安装/取消)。
 * 附更新日志:限高可滚动,使用悬浮滚动条。
 * 入场复用 view-in 动画(淡入上浮)。
 */
export function UpdatePopup() {
  const { phase, tag, body, progress, errorMsg, hide, startDownload, cancelDownload, install, discard } =
    useUpdate();
  const logRef = useRef<HTMLDivElement>(null);

  if (phase === "hidden") return null;

  return (
    <Box
      position="fixed"
      bottom={4}
      right={4}
      zIndex={1000}
      w="300px"
      p={4}
      bg="bg"
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="12px"
      boxShadow="lg"
      {...viewInAnimation}
    >
      <HStack justify="space-between" align="center">
        <HStack gap={2} minW={0}>
          <Download size={16} style={{ flexShrink: 0 }} />
          <Text fontSize="sm" fontWeight="semibold" truncate>
            发现新版本 {tag}
          </Text>
        </HStack>
        {phase !== "downloading" && (
          <IconButton aria-label="关闭更新提示" variant="ghost" size="xs" flexShrink={0} onClick={hide}>
            <X size={14} />
          </IconButton>
        )}
      </HStack>

      {/* 更新日志:限高可滚动(悬浮滚动条) */}
      {body && (
        <Box position="relative" mt={3}>
          <Box
            ref={logRef}
            className="no-scrollbar"
            maxH="130px"
            overflowY="auto"
            p={2.5}
            bg="bg.subtle"
            borderRadius="8px"
          >
            <Text fontSize="xs" color="fg.muted" whiteSpace="pre-wrap" wordBreak="break-word" lineHeight="1.6">
              {body}
            </Text>
          </Box>
          <FloatingScrollbar targetRef={logRef} />
        </Box>
      )}

      {phase === "prompt" && (
        <>
          <Text fontSize="xs" color="fg.muted" mt={2}>
            新版本已发布,是否立即下载?
          </Text>
          <HStack mt={3} justify="flex-end" gap={2}>
            <Button size="xs" variant="ghost" onClick={hide}>
              取消
            </Button>
            <Button size="xs" variant="solid" gap={1} onClick={() => void startDownload()}>
              <Download size={12} />
              下载
            </Button>
          </HStack>
        </>
      )}

      {phase === "downloading" && (
        <Box mt={3}>
          <HStack justify="space-between" mb={1}>
            <Text fontSize="xs" color="fg.muted">
              正在下载...
            </Text>
            <Text fontSize="xs" color="fg.muted" fontVariantNumeric="tabular-nums">
              {Math.round(progress)}%
            </Text>
          </HStack>
          <Box h="6px" bg="bg.subtle" borderRadius="full" overflow="hidden">
            <Box
              h="full"
              bg="fg"
              borderRadius="full"
              width={`${Math.min(100, Math.max(0, progress))}%`}
              transition="width 0.2s ease"
            />
          </Box>
          <HStack mt={3} justify="flex-end">
            <Button size="xs" variant="ghost" onClick={() => void cancelDownload()}>
              取消
            </Button>
          </HStack>
        </Box>
      )}

      {phase === "complete" && (
        <>
          <Text fontSize="xs" color="fg.muted" mt={2}>
            下载完成,是否立即安装?
          </Text>
          <HStack mt={3} justify="flex-end" gap={2}>
            <Button size="xs" variant="ghost" onClick={() => void discard()}>
              取消
            </Button>
            <Button size="xs" variant="solid" gap={1} onClick={() => void install()}>
              <RefreshCw size={12} />
              重启安装
            </Button>
          </HStack>
        </>
      )}

      {phase === "error" && (
        <>
          <Text fontSize="xs" color="red.400" mt={2} wordBreak="break-all">
            {errorMsg || "下载失败,请稍后再试"}
          </Text>
          <HStack mt={3} justify="flex-end">
            <Button size="xs" variant="ghost" onClick={hide}>
              关闭
            </Button>
          </HStack>
        </>
      )}
    </Box>
  );
}
