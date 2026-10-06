import { useRef } from "react";
import { Box, Button, HStack, IconButton, Text } from "@chakra-ui/react";
import { Download, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { viewInAnimation } from "../theme/theme";
import { FloatingScrollbar } from "./FloatingScrollbar";
import { useUpdate } from "../stores/update";
import { IS_STORE_BUILD } from "../lib/build-flags";

/**
 * 新版本更新小弹窗(固定右下角),与关于页的检查更新共用同一个 store:
 * 提示(下载/取消) → 下载中(进度条/取消) → 下载完成(重启安装/取消)。
 * 附更新日志:限高可滚动,使用悬浮滚动条。
 * 入场复用 view-in 动画(淡入上浮)。
 */
export function UpdatePopup() {
  const { t } = useTranslation();
  const { phase, tag, body, progress, errorMsg, hide, startDownload, cancelDownload, install, discard } =
    useUpdate();
  const logRef = useRef<HTMLDivElement>(null);

  // 商店版(MSIX)更新由商店接管,永不弹出。
  if (IS_STORE_BUILD || phase === "hidden") return null;

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
            {t("misc.foundNewVersion", { tag })}
          </Text>
        </HStack>
        {phase !== "downloading" && (
          <IconButton aria-label={t("misc.closeUpdateNotice")} variant="ghost" size="xs" flexShrink={0} onClick={hide}>
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
            {t("misc.updatePromptDownload")}
          </Text>
          <HStack mt={3} justify="flex-end" gap={2}>
            <Button size="xs" variant="ghost" onClick={hide}>
              {t("misc.cancel")}
            </Button>
            <Button size="xs" variant="solid" gap={1} onClick={() => void startDownload()}>
              <Download size={12} />
              {t("misc.download")}
            </Button>
          </HStack>
        </>
      )}

      {phase === "downloading" && (
        <Box mt={3}>
          <HStack justify="space-between" mb={1}>
            <Text fontSize="xs" color="fg.muted">
              {t("misc.downloading")}
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
              {t("misc.cancel")}
            </Button>
          </HStack>
        </Box>
      )}

      {phase === "complete" && (
        <>
          <Text fontSize="xs" color="fg.muted" mt={2}>
            {t("misc.updatePromptInstall")}
          </Text>
          <HStack mt={3} justify="flex-end" gap={2}>
            <Button size="xs" variant="ghost" onClick={() => void discard()}>
              {t("misc.cancel")}
            </Button>
            <Button size="xs" variant="solid" gap={1} onClick={() => void install()}>
              <RefreshCw size={12} />
              {t("misc.restartInstall")}
            </Button>
          </HStack>
        </>
      )}

      {phase === "error" && (
        <>
          <Text fontSize="xs" color="red.400" mt={2} wordBreak="break-all">
            {errorMsg || t("misc.downloadFailedRetry")}
          </Text>
          <HStack mt={3} justify="flex-end">
            <Button size="xs" variant="ghost" onClick={hide}>
              {t("misc.close")}
            </Button>
          </HStack>
        </>
      )}
    </Box>
  );
}
