import { useTranslation } from "react-i18next";
import { Button, Dialog, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import { useConfirm } from "../stores/confirm";
import { useOverlayBlur } from "../lib/overlayBlur";

/**
 * 「未保存修改」确认弹窗:关闭有改动未保存的标签页时由 tabs store 发起,
 * 让用户选择「保存」或「不保存」(点 X / Esc 视为取消,不关闭标签页)。
 * 替代系统原生 MessageBox,外观与应用其余弹窗保持一致。
 */
export function UnsavedDialog() {
  const { t } = useTranslation();
  const open = useConfirm((s) => s.open);
  const fileName = useConfirm((s) => s.fileName);
  const settle = useConfirm((s) => s.settleUnsaved);
  // 打开时模糊整个 App 内容(见 lib/overlayBlur.ts)。
  useOverlayBlur(open);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) settle("cancel");
      }}
      placement="center"
      size="sm"
    >
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.300" />
        <Dialog.Positioner>
          <Dialog.Content
            borderRadius="12px"
            borderWidth="1px"
            borderColor="border.subtle"
            bg="bg"
            p={6}
            w="min(380px, 90vw)"
          >
            <VStack gap={3} align="stretch">
              <Dialog.Title fontSize="md">{t("tabs.unsavedDialog.title")}</Dialog.Title>
              <Dialog.Body p={0}>
                <Text fontSize="sm" color="fg.muted">
                  <Text as="span" fontWeight="medium" color="fg">
                    {fileName}
                  </Text>
                  {t("tabs.unsavedDialog.messageSuffix")}
                </Text>
              </Dialog.Body>
              <Dialog.Footer p={0} pt={1}>
                <HStack gap={2} w="100%" justify="flex-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => settle("discard")}
                  >
                    {t("tabs.unsavedDialog.discard")}
                  </Button>
                  <Button
                    size="sm"
                    variant="solid"
                    colorPalette="gray"
                    onClick={() => settle("save")}
                  >
                    {t("tabs.unsavedDialog.save")}
                  </Button>
                </HStack>
              </Dialog.Footer>
            </VStack>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
