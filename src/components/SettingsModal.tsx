import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Box,
  Button,
  Dialog,
  Flex,
  HStack,
  IconButton,
  Image,
  Portal,
  Text,
  VStack,
} from "@chakra-ui/react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTheme } from "next-themes";
import { FaQq } from "react-icons/fa6";
import { RiBilibiliFill, RiTiktokFill } from "react-icons/ri";
import {
  Download,
  Heart,
  Info,
  Minus,
  Palette,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useSettings } from "../stores/settings";
import { useUpdate } from "../stores/update";
import { isMdAssociated, registerMdAssociation, unregisterMdAssociation } from "../tauri/api";
import { FloatingScrollbar } from "./FloatingScrollbar";
import { QqGroupSection } from "./QqGroupSection";

type SectionId = "general" | "appearance" | "sponsor" | "qq" | "about";

// 图标兼容 lucide 与 react-icons 两类组件
const SECTIONS: { id: SectionId; label: string; icon: ComponentType<{ size?: number | string }> }[] = [
  { id: "general", label: "通用", icon: SlidersHorizontal },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "sponsor", label: "赞助", icon: Heart },
  { id: "qq", label: "QQ群", icon: FaQq },
  { id: "about", label: "关于", icon: Info },
];

function GeneralSection() {
  // 文件关联状态:null = 未知/浏览器预览(不渲染该行)
  const [assoc, setAssoc] = useState<boolean | null>(null);
  const [assocBusy, setAssocBusy] = useState(false);
  // 关闭窗口行为(与关闭询问对话框的"不再提醒"共用一个设置)
  const { closeAction, setCloseAction } = useSettings();

  useEffect(() => {
    isMdAssociated()
      .then(setAssoc)
      .catch(() => setAssoc(null));
  }, []);

  const toggleAssociation = async () => {
    setAssocBusy(true);
    try {
      if (assoc) {
        await unregisterMdAssociation();
      } else {
        await registerMdAssociation();
      }
      setAssoc(!assoc);
    } catch (e) {
      console.error("文件关联操作失败:", e);
    } finally {
      setAssocBusy(false);
    }
  };

  return (
    <VStack align="stretch" gap={0}>
      <Flex
        justify="space-between"
        align="center"
        gap={6}
        py={3}
        borderBottomWidth="1px"
        borderColor="border.subtle"
      >
        <Text fontSize="sm" color="fg.muted" flexShrink={0}>
          关闭窗口
        </Text>
        <HStack gap={1}>
          {(
            [
              { v: "ask", label: "每次询问" },
              { v: "tray", label: "隐藏到托盘" },
              { v: "exit", label: "直接退出" },
            ] as const
          ).map((opt) => (
            <Button
              key={opt.v}
              size="xs"
              variant={closeAction === opt.v ? "subtle" : "ghost"}
              onClick={() => setCloseAction(opt.v)}
            >
              {opt.label}
            </Button>
          ))}
        </HStack>
      </Flex>
      {assoc !== null && (
        <Flex
          justify="space-between"
          align="center"
          gap={6}
          py={3}
          borderBottomWidth="1px"
          borderColor="border.subtle"
        >
          <Text fontSize="sm" color="fg.muted" flexShrink={0}>
            文件关联
          </Text>
          <HStack gap={3}>
            <Text fontSize="sm">{assoc ? "已关联 .md 等文件" : "未关联"}</Text>
            <Button
              size="xs"
              variant={assoc ? "outline" : "subtle"}
              borderColor="border.subtle"
              disabled={assocBusy}
              onClick={() => void toggleAssociation()}
            >
              {assoc ? "取消关联" : "设为默认"}
            </Button>
          </HStack>
        </Flex>
      )}
    </VStack>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { fontSize, setFontSize } = useSettings();

  return (
    <VStack align="stretch" gap={0}>
      <Flex justify="space-between" align="center" gap={6} py={3} borderBottomWidth="1px" borderColor="border.subtle">
        <Text fontSize="sm" color="fg.muted" flexShrink={0}>
          主题
        </Text>
        <HStack gap={1}>
          {(
            [
              { v: "light", label: "亮色" },
              { v: "dark", label: "暗色" },
              { v: "system", label: "跟随系统" },
            ] as const
          ).map((opt) => (
            <Button
              key={opt.v}
              size="xs"
              variant={theme === opt.v ? "subtle" : "ghost"}
              onClick={() => setTheme(opt.v)}
            >
              {opt.label}
            </Button>
          ))}
        </HStack>
      </Flex>

      <Flex justify="space-between" align="center" gap={6} py={3} borderBottomWidth="1px" borderColor="border.subtle">
        <Text fontSize="sm" color="fg.muted" flexShrink={0}>
          正文字号 (13-28)
        </Text>
        <HStack gap={1}>
          <IconButton aria-label="减小字号" variant="ghost" size="xs" onClick={() => setFontSize(fontSize - 1)}>
            <Minus size={13} />
          </IconButton>
          <Text w="30px" textAlign="center" fontSize="sm">
            {fontSize}
          </Text>
          <IconButton aria-label="增大字号" variant="ghost" size="xs" onClick={() => setFontSize(fontSize + 1)}>
            <Plus size={13} />
          </IconButton>
        </HStack>
      </Flex>
    </VStack>
  );
}

function SponsorSection() {
  return (
    <VStack align="center" gap={4} pt={2}>
      <Text fontSize="sm" color="fg.muted" textAlign="center">
        如果 OpenMD 对你有帮助,欢迎请作者喝杯咖啡~
      </Text>
      <Flex gap={6} wrap="wrap" justify="center">
        <VStack
          gap={2}
          p={3}
          borderWidth="1px"
          borderColor="border.subtle"
          borderRadius="12px"
        >
          <Image src="/alipay.webp" alt="支付宝收款码" w="150px" h="150px" borderRadius="8px" objectFit="cover" />
          <Text fontSize="sm">支付宝</Text>
        </VStack>
        <VStack
          gap={2}
          p={3}
          borderWidth="1px"
          borderColor="border.subtle"
          borderRadius="12px"
        >
          <Image src="/wechat.png" alt="微信收款码" w="150px" h="150px" borderRadius="8px" objectFit="cover" />
          <Text fontSize="sm">微信</Text>
        </VStack>
      </Flex>
    </VStack>
  );
}

/** 作者的平台链接(与 NexBox 相同)。 */
const AUTHOR_LINKS = [
  {
    label: "小黑盒",
    url: "https://xiaoheihe.cn/app/user/profile/56380800",
    icon: <img src="/icons/xiaoheihe.webp" alt="小黑盒" style={{ width: "20px", height: "20px", objectFit: "contain" }} />,
  },
  {
    label: "Bilibili",
    url: "https://space.bilibili.com/1614951812",
    icon: <RiBilibiliFill size={19} color="#00A1D6" />,
  },
  {
    label: "抖音",
    url: "https://www.douyin.com/user/MS4wLjABAAAAytD1zP6zVeXgPQuG-PWHq4AhsZz9zNXPcJap2JVaoG88Ani9tmBj0FtH7DLrQWsH",
    icon: <RiTiktokFill size={18} color="currentColor" />,
  },
];

function AboutSection() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const [version, setVersion] = useState("1.0.1");
  const { lastCheck, tag: latestTag, check, phase, progress, errorMsg, startDownload, install } =
    useUpdate();

  useEffect(() => {
    // Tauri 环境读真实版本号;浏览器预览保持默认值。
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  const openLink = async (url: string) => {
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  const checking = lastCheck === "checking";

  return (
    <VStack align="stretch" gap={0} pt={2}>
      {/* Logo(居中,位置偏上) */}
      <Flex justify="center" py={4}>
        <img
          src={isDark ? "/wordmark-white.png" : "/wordmark-black.png"}
          alt="OpenMD"
          draggable={false}
          style={{
            width: "min(300px, 72%)",
            height: "auto",
            mixBlendMode: isDark ? "screen" : "multiply",
            userSelect: "none",
          }}
        />
      </Flex>

      {/* 版本行(与外观页同款样式) */}
      <Flex justify="space-between" align="center" gap={6} py={3} borderBottomWidth="1px" borderColor="border.subtle">
        <Text fontSize="sm" color="fg.muted" flexShrink={0}>
          版本
        </Text>
        <HStack gap={3}>
          <Text fontSize="sm">{version}</Text>
          <Button
            size="xs"
            variant="outline"
            borderColor="border.subtle"
            gap={1}
            onClick={() => void check()}
            disabled={checking}
          >
            <RefreshCw size={12} className={checking ? "animate-spin" : undefined} />
            {checking ? "检查中..." : "检查更新"}
          </Button>
        </HStack>
      </Flex>

      {/* 更新行:与右下角弹窗共用状态,内嵌 下载→进度→重启安装 完整流程 */}
      {(lastCheck === "available" || phase === "downloading" || phase === "complete" || phase === "error") && (
        <Flex justify="space-between" align="center" gap={6} py={3} borderBottomWidth="1px" borderColor="border.subtle">
          <Text fontSize="sm" color="fg.muted" flexShrink={0}>
            更新
          </Text>
          <Box flex={1} minW={0}>
            <Flex justify="flex-end" align="center" gap={3}>
              {phase === "prompt" && (
                <>
                  <Text fontSize="sm">发现新版本 {latestTag}</Text>
                  <Button size="xs" variant="subtle" gap={1} onClick={() => void startDownload()}>
                    <Download size={12} />
                    下载
                  </Button>
                </>
              )}
              {phase === "complete" && (
                <>
                  <Text fontSize="sm">下载完成</Text>
                  <Button size="xs" variant="subtle" gap={1} onClick={() => void install()}>
                    <RefreshCw size={12} />
                    重启安装
                  </Button>
                </>
              )}
              {phase === "error" && (
                <Text fontSize="sm" color="red.400" wordBreak="break-all">
                  {errorMsg || "下载失败,请稍后再试"}
                </Text>
              )}
            </Flex>
            {phase === "downloading" && (
              <VStack align="stretch" gap={1} ml="auto" w="240px">
                <HStack justify="space-between">
                  <Text fontSize="xs" color="fg.muted">
                    正在下载 {latestTag}...
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
              </VStack>
            )}
          </Box>
        </Flex>
      )}

      {lastCheck === "latest" && (
        <Flex justify="space-between" align="center" gap={6} py={3} borderBottomWidth="1px" borderColor="border.subtle">
          <Text fontSize="sm" color="fg.muted" flexShrink={0}>
            更新
          </Text>
          <Text fontSize="sm">已是最新版本</Text>
        </Flex>
      )}

      {lastCheck === "error" && phase !== "error" && (
        <Flex justify="space-between" align="center" gap={6} py={3} borderBottomWidth="1px" borderColor="border.subtle">
          <Text fontSize="sm" color="fg.muted" flexShrink={0}>
            更新
          </Text>
          <Text fontSize="sm" color="red.400">
            检查失败,请稍后再试
          </Text>
        </Flex>
      )}

      {/* 作者行(与外观页同款样式) */}
      <Flex justify="space-between" align="center" gap={6} py={3} borderBottomWidth="1px" borderColor="border.subtle">
        <Text fontSize="sm" color="fg.muted" flexShrink={0}>
          作者
        </Text>
        <HStack gap={4}>
          <HStack gap={2}>
            <Box
              w="32px"
              h="32px"
              borderRadius="lg"
              overflow="hidden"
              display="flex"
              alignItems="center"
              justifyContent="center"
              flexShrink={0}
            >
              <img
                src="/logo/MuLiuSaMa.webp"
                alt="木流"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </Box>
            <Text fontSize="sm" fontWeight="medium">
              木流
            </Text>
          </HStack>
          <Flex align="center" gap={2}>
            {AUTHOR_LINKS.map((p) => (
              <Box
                key={p.label}
                w="28px"
                h="28px"
                borderRadius="md"
                display="flex"
                alignItems="center"
                justifyContent="center"
                cursor="pointer"
                color="fg.muted"
                transition="all 0.2s"
                _hover={{ bg: "bg.subtle", color: "fg", transform: "scale(1.1)" }}
                onClick={() => void openLink(p.url)}
              >
                {p.icon}
              </Box>
            ))}
          </Flex>
        </HStack>
      </Flex>
    </VStack>
  );
}

/**
 * 设置弹窗:左侧导航(通用/外观/赞助/关于) + 右侧内容。
 * 背景半透明模糊;由首页左下角与顶栏"主题"左侧的设置按钮唤起。
 */
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [section, setSection] = useState<SectionId>("general");
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) onClose();
      }}
      placement="center"
      size="full"
    >
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.300" backdropFilter="blur(10px)" />
        <Dialog.Positioner>
          <Dialog.Content
            borderRadius="12px"
            borderWidth="1px"
            borderColor="border.subtle"
            bg="bg"
            overflow="hidden"
            w="min(750px, 94vw)"
            h="min(500px, 80vh)"
            minH={0}
          >
            <Dialog.CloseTrigger asChild>
              <IconButton
                aria-label="关闭设置"
                variant="ghost"
                size="xs"
                position="absolute"
                top={3}
                right={3}
                zIndex={40}
              >
                <X size={15} />
              </IconButton>
            </Dialog.CloseTrigger>

            <Dialog.Body p={0} h="full" display="flex">
              {/* 左侧导航(pt 与内容区 p=6 对齐,首行按钮和第一行文字齐平) */}
              <VStack
                w="150px"
                flexShrink={0}
                align="stretch"
                gap={1}
                p={3}
                pt={6}
                borderRightWidth="1px"
                borderColor="border.subtle"
                bg="bg.subtle"
              >
                {SECTIONS.map((s) => {
                  const active = s.id === section;
                  return (
                    <Button
                      key={s.id}
                      w="full"
                      justifyContent="flex-start"
                      gap={2}
                      size="sm"
                      variant={active ? "subtle" : "ghost"}
                      onClick={() => setSection(s.id)}
                    >
                      <s.icon size={15} />
                      {s.label}
                    </Button>
                  );
                })}
              </VStack>

              {/* 右侧内容:悬浮滚动条 */}
              <Box flex={1} minW={0} position="relative" display="flex">
                <Box ref={contentRef} className="no-scrollbar" flex={1} minW={0} p={6} overflowY="auto">
                  {section === "general" && <GeneralSection />}
                  {section === "appearance" && <AppearanceSection />}
                  {section === "sponsor" && <SponsorSection />}
                  {section === "qq" && <QqGroupSection />}
                  {section === "about" && <AboutSection />}
                </Box>
                <FloatingScrollbar targetRef={contentRef} />
              </Box>
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
