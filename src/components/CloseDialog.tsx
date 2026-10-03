import { useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  HStack,
  Portal,
  Text,
  VStack,
} from "@chakra-ui/react";
import { invoke } from "@tauri-apps/api/core";
import { Minimize2, LogOut } from "lucide-react";
import { useSettings } from "../stores/settings";

/** True when running inside the Tauri webview (false in a plain browser). */
const IN_TAURI = "__TAURI_INTERNALS__" in window;

interface CloseDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 关闭询问对话框:点 X / Alt+F4 时由 Rust 拦截并发来 close-requested 事件,
 * 询问"隐藏到托盘"还是"退出程序"。勾选"不再提醒"后写入设置(通用页可改回)。
 */
export function CloseDialog({ open, onClose }: CloseDialogProps) {
  const [remember, setRemember] = useState(false);
  const setCloseAction = useSettings((s) => s.setCloseAction);

  // 每次打开重置勾选,避免上次的选择被静默带入
  useEffect(() => {
    if (open) setRemember(false);
  }, [open]);

  const hideToTray = () => {
    onClose();
    if (remember) setCloseAction("tray");
    if (!IN_TAURI) return;
    void invoke("hide_to_tray").catch(() => {});
  };

  const quit = () => {
    if (remember) setCloseAction("exit");
    if (!IN_TAURI) return;
    void invoke("quit_app").catch(() => {});
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) onClose();
      }}
      placement="center"
      size="sm"
    >
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.300" backdropFilter="blur(10px)" />
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
              <Dialog.Title fontSize="md">关闭 OpenMD</Dialog.Title>
              <Dialog.Body p={0}>
                <VStack gap={3} align="stretch">
                  <Text fontSize="sm" color="fg.muted">
                    要隐藏到系统托盘继续运行，还是退出 OpenMD？
                  </Text>
                  <Checkbox.Root
                    size="sm"
                    checked={remember}
                    onCheckedChange={(e) => setRemember(e.checked === true)}
                  >
                    <Checkbox.HiddenInput />
                    <Checkbox.Control />
                    <Checkbox.Label>不再提醒，记住我的选择</Checkbox.Label>
                  </Checkbox.Root>
                </VStack>
              </Dialog.Body>
              <Dialog.Footer p={0} pt={1}>
                <HStack gap={2} w="100%" justify="flex-end">
                  <Button size="sm" variant="ghost" onClick={onClose}>
                    取消
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    colorPalette="blue"
                    onClick={hideToTray}
                  >
                    <Minimize2 size={14} />
                    隐藏到托盘
                  </Button>
                  <Button
                    size="sm"
                    variant="solid"
                    colorPalette="red"
                    onClick={quit}
                  >
                    <LogOut size={14} />
                    退出
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
