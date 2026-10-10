import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Box,
  Button,
  chakra,
  Dialog,
  Flex,
  HStack,
  IconButton,
  Image,
  Menu,
  Portal,
  Slider,
  Text,
  VStack,
} from "@chakra-ui/react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { FaQq } from "react-icons/fa6";
import { RiBilibiliFill, RiTiktokFill } from "react-icons/ri";
import {
  Check,
  ChevronDown,
  Download,
  Heart,
  ImagePlus,
  Info,
  Minus,
  Palette,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useSettings, MAX_BACKGROUND_BLUR, type Language } from "../stores/settings";
import { useUpdate } from "../stores/update";
import { IS_STORE_BUILD } from "../lib/build-flags";
import { isMdAssociated, openImageDialog, registerMdAssociation, unregisterMdAssociation } from "../tauri/api";
import { useBackgroundSrc } from "../lib/useBackgroundSrc";
import { useOverlayBlur } from "../lib/overlayBlur";
import { FloatingScrollbar } from "./FloatingScrollbar";
import { QqGroupSection } from "./QqGroupSection";

type SectionId = "general" | "appearance" | "sponsor" | "qq" | "about";

// 图标兼容 lucide 与 react-icons 两类组件
const SECTIONS: { id: SectionId; labelKey: string; icon: ComponentType<{ size?: number | string }> }[] = [
  { id: "general", labelKey: "settings.section.general", icon: SlidersHorizontal },
  { id: "appearance", labelKey: "settings.section.appearance", icon: Palette },
  { id: "sponsor", labelKey: "settings.section.sponsor", icon: Heart },
  { id: "qq", labelKey: "settings.section.qq", icon: FaQq },
  { id: "about", labelKey: "settings.section.about", icon: Info },
];

// 商店版不展示赞助与 QQ 群入口(微软政策 10.1.5 / 10.2.3:不得引导用户离开商店)。
const visibleSections = SECTIONS.filter(
  (s) => !(IS_STORE_BUILD && (s.id === "sponsor" || s.id === "qq")),
);

function GeneralSection() {
  const { t } = useTranslation();
  // 文件关联状态:null = 未知/浏览器预览(不渲染该行)
  const [assoc, setAssoc] = useState<boolean | null>(null);
  const [assocBusy, setAssocBusy] = useState(false);
  // 关闭窗口行为(与关闭询问对话框的"不再提醒"共用一个设置)
  const { closeAction, setCloseAction } = useSettings();

  useEffect(() => {
    // 商店版(MSIX)下注册表写入被虚拟化,开关无效:文件关联由
    // AppxManifest 的 fileTypeAssociation 声明,这里不再查询/渲染该行。
    if (IS_STORE_BUILD) return;
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
      <LanguageRow />
      <Flex
        justify="space-between"
        align="center"
        gap={6}
        py={3}
        borderBottomWidth="1px"
        borderColor="border.subtle"
      >
        <Text fontSize="sm" color="fg.muted" flexShrink={0}>
          {t("settings.general.closeWindow")}
        </Text>
        <HStack gap={1}>
          {(
            [
              { v: "ask", label: t("settings.general.closeAction.ask") },
              { v: "tray", label: t("settings.general.closeAction.tray") },
              { v: "exit", label: t("settings.general.closeAction.exit") },
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
            {t("settings.general.fileAssociation")}
          </Text>
          <HStack gap={3}>
            <Text fontSize="sm">{assoc ? t("settings.general.associated") : t("settings.general.notAssociated")}</Text>
            <Button
              size="xs"
              variant={assoc ? "outline" : "subtle"}
              borderColor="border.subtle"
              disabled={assocBusy}
              onClick={() => void toggleAssociation()}
            >
              {assoc ? t("settings.general.disassociate") : t("settings.general.setDefault")}
            </Button>
          </HStack>
        </Flex>
      )}
    </VStack>
  );
}

function AppearanceSection() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const {
    fontSize,
    setFontSize,
    backgroundImage,
    backgroundBlur,
    setBackgroundImage,
    setBackgroundBlur,
  } = useSettings();

  // 选一张图片作为整窗背景;取消选择即清空。
  const pickBackground = async () => {
    const picked = await openImageDialog().catch(() => null);
    if (picked) setBackgroundImage(picked);
  };
  const backgroundName = backgroundImage ? backgroundImage.split(/[\\/]/).pop() : null;
  // 预览缩略图:走和背景层同一条资源协议放行逻辑。
  const backgroundSrc = useBackgroundSrc(backgroundImage);

  return (
    <VStack align="stretch" gap={0}>
      <Flex justify="space-between" align="center" gap={6} py={3} borderBottomWidth="1px" borderColor="border.subtle">
        <Text fontSize="sm" color="fg.muted" flexShrink={0}>
          {t("settings.appearance.theme")}
        </Text>
        <HStack gap={1}>
          {(
            [
              { v: "light", label: t("settings.appearance.themeLight") },
              { v: "dark", label: t("settings.appearance.themeDark") },
              { v: "system", label: t("settings.appearance.themeSystem") },
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
          {t("settings.appearance.fontSize")}
        </Text>
        <HStack gap={1}>
          <IconButton aria-label={t("settings.appearance.fontSizeDecrease")} variant="ghost" size="xs" onClick={() => setFontSize(fontSize - 1)}>
            <Minus size={13} />
          </IconButton>
          <Text w="30px" textAlign="center" fontSize="sm">
            {fontSize}
          </Text>
          <IconButton aria-label={t("settings.appearance.fontSizeIncrease")} variant="ghost" size="xs" onClick={() => setFontSize(fontSize + 1)}>
            <Plus size={13} />
          </IconButton>
        </HStack>
      </Flex>

      <Flex justify="space-between" align="center" gap={6} py={3} borderBottomWidth="1px" borderColor="border.subtle">
        <Text fontSize="sm" color="fg.muted" flexShrink={0}>
          {t("settings.appearance.background")}
        </Text>
        <HStack gap={2} minW={0}>
          {backgroundSrc && (
            <chakra.button
              type="button"
              title={t("settings.appearance.backgroundChoose")}
              onClick={() => void pickBackground()}
              w="44px"
              h="28px"
              flexShrink={0}
              borderRadius="6px"
              borderWidth="1px"
              borderColor="border.subtle"
              overflow="hidden"
              cursor="pointer"
            >
              <img
                src={backgroundSrc}
                alt=""
                draggable={false}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </chakra.button>
          )}
          <Text fontSize="xs" color="fg.subtle" truncate maxW="160px" title={backgroundImage ?? undefined}>
            {backgroundName ?? t("settings.appearance.backgroundNone")}
          </Text>
          <Button size="xs" variant="subtle" gap={1} onClick={() => void pickBackground()}>
            <ImagePlus size={12} />
            {t("settings.appearance.backgroundChoose")}
          </Button>
          {backgroundImage && (
            <IconButton
              aria-label={t("settings.appearance.backgroundRemove")}
              title={t("settings.appearance.backgroundRemove")}
              variant="ghost"
              size="xs"
              onClick={() => setBackgroundImage(null)}
            >
              <X size={13} />
            </IconButton>
          )}
        </HStack>
      </Flex>

      {/* 模糊只在有背景图时才有意义,没图就不显示这一行。 */}
      {backgroundImage && (
        <Flex justify="space-between" align="center" gap={6} py={3} borderBottomWidth="1px" borderColor="border.subtle">
          <Text fontSize="sm" color="fg.muted" flexShrink={0}>
            {t("settings.appearance.backgroundBlur")}
          </Text>
          <HStack gap={3}>
            <Slider.Root
              min={0}
              max={MAX_BACKGROUND_BLUR}
              step={1}
              size="sm"
              w="140px"
              value={[backgroundBlur]}
              onValueChange={(e) => setBackgroundBlur(e.value[0])}
            >
              <Slider.Control>
                <Slider.Track>
                  <Slider.Range />
                </Slider.Track>
                <Slider.Thumbs />
              </Slider.Control>
            </Slider.Root>
            <Text w="30px" textAlign="right" fontSize="sm" fontVariantNumeric="tabular-nums">
              {backgroundBlur}
            </Text>
          </HStack>
        </Flex>
      )}
    </VStack>
  );
}

function SponsorSection() {
  const { t } = useTranslation();
  return (
    <VStack align="center" gap={4} pt={2}>
      <Text fontSize="sm" color="fg.muted" textAlign="center">
        {t("settings.sponsor.invite")}
      </Text>
      <Flex gap={6} wrap="wrap" justify="center">
        <VStack
          gap={2}
          p={3}
          borderWidth="1px"
          borderColor="border.subtle"
          borderRadius="12px"
        >
          <Image src="/alipay.webp" alt={t("settings.sponsor.alipayQr")} w="150px" h="150px" borderRadius="8px" objectFit="cover" />
          <Text fontSize="sm">{t("settings.sponsor.alipay")}</Text>
        </VStack>
        <VStack
          gap={2}
          p={3}
          borderWidth="1px"
          borderColor="border.subtle"
          borderRadius="12px"
        >
          <Image src="/wechat.png" alt={t("settings.sponsor.wechatQr")} w="150px" h="150px" borderRadius="8px" objectFit="cover" />
          <Text fontSize="sm">{t("settings.sponsor.wechat")}</Text>
        </VStack>
      </Flex>
    </VStack>
  );
}

function AboutSection() {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const [version, setVersion] = useState("1.0.3");
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

  /** 作者的平台链接(与 NexBox 相同)。商店版按微软政策不构建、不展示。 */
  const authorLinks = IS_STORE_BUILD
    ? []
    : [
        {
          label: t("settings.about.xiaoheihe"),
          url: "https://xiaoheihe.cn/app/user/profile/56380800",
          icon: <img src="/icons/xiaoheihe.webp" alt={t("settings.about.xiaoheihe")} style={{ width: "20px", height: "20px", objectFit: "contain" }} />,
        },
        {
          label: "Bilibili",
          url: "https://space.bilibili.com/1614951812",
          icon: <RiBilibiliFill size={19} color="#00A1D6" />,
        },
        {
          label: t("settings.about.douyin"),
          url: "https://www.douyin.com/user/MS4wLjABAAAAytD1zP6zVeXgPQuG-PWHq4AhsZz9zNXPcJap2JVaoG88Ani9tmBj0FtH7DLrQWsH",
          icon: <RiTiktokFill size={18} color="currentColor" />,
        },
      ];

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
          {t("settings.about.version")}
        </Text>
        <HStack gap={3}>
          <Text fontSize="sm">{version}</Text>
          {!IS_STORE_BUILD && (
            <Button
              size="xs"
              variant="outline"
              borderColor="border.subtle"
              gap={1}
              onClick={() => void check()}
              disabled={checking}
            >
              <RefreshCw size={12} className={checking ? "animate-spin" : undefined} />
              {checking ? t("settings.about.checking") : t("settings.about.checkUpdate")}
            </Button>
          )}
        </HStack>
      </Flex>

      {/* 更新行:与右下角弹窗共用状态,内嵌 下载→进度→重启安装 完整流程 */}
      {/* 商店版更新由商店接管,不渲染应用内更新 UI */}
      {!IS_STORE_BUILD && (lastCheck === "available" || phase === "downloading" || phase === "complete" || phase === "error") && (
        <Flex justify="space-between" align="center" gap={6} py={3} borderBottomWidth="1px" borderColor="border.subtle">
          <Text fontSize="sm" color="fg.muted" flexShrink={0}>
            {t("settings.about.update")}
          </Text>
          <Box flex={1} minW={0}>
            <Flex justify="flex-end" align="center" gap={3}>
              {phase === "prompt" && (
                <>
                  <Text fontSize="sm">{t("settings.about.newVersion", { tag: latestTag })}</Text>
                  <Button size="xs" variant="subtle" gap={1} onClick={() => void startDownload()}>
                    <Download size={12} />
                    {t("settings.about.download")}
                  </Button>
                </>
              )}
              {phase === "complete" && (
                <>
                  <Text fontSize="sm">{t("settings.about.downloadComplete")}</Text>
                  <Button size="xs" variant="subtle" gap={1} onClick={() => void install()}>
                    <RefreshCw size={12} />
                    {t("settings.about.restartInstall")}
                  </Button>
                </>
              )}
              {phase === "error" && (
                <Text fontSize="sm" color="red.400" wordBreak="break-all">
                  {errorMsg || t("settings.about.downloadFailed")}
                </Text>
              )}
            </Flex>
            {phase === "downloading" && (
              <VStack align="stretch" gap={1} ml="auto" w="240px">
                <HStack justify="space-between">
                  <Text fontSize="xs" color="fg.muted">
                    {t("settings.about.downloading", { tag: latestTag })}
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

      {!IS_STORE_BUILD && lastCheck === "latest" && (
        <Flex justify="space-between" align="center" gap={6} py={3} borderBottomWidth="1px" borderColor="border.subtle">
          <Text fontSize="sm" color="fg.muted" flexShrink={0}>
            {t("settings.about.update")}
          </Text>
          <Text fontSize="sm">{t("settings.about.upToDate")}</Text>
        </Flex>
      )}

      {!IS_STORE_BUILD && lastCheck === "error" && phase !== "error" && (
        <Flex justify="space-between" align="center" gap={6} py={3} borderBottomWidth="1px" borderColor="border.subtle">
          <Text fontSize="sm" color="fg.muted" flexShrink={0}>
            {t("settings.about.update")}
          </Text>
          <Text fontSize="sm" color="red.400">
            {t("settings.about.checkFailed")}
          </Text>
        </Flex>
      )}

      {/* 作者行(与外观页同款样式) */}
      <Flex justify="space-between" align="center" gap={6} py={3} borderBottomWidth="1px" borderColor="border.subtle">
        <Text fontSize="sm" color="fg.muted" flexShrink={0}>
          {t("settings.about.author")}
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
                alt={t("settings.about.authorName")}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </Box>
            <Text fontSize="sm" fontWeight="medium">
              {t("settings.about.authorName")}
            </Text>
          </HStack>
          {!IS_STORE_BUILD && (
            <Flex align="center" gap={2}>
              {authorLinks.map((p) => (
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
          )}
        </HStack>
      </Flex>
    </VStack>
  );
}

/** 界面语言选择行(通用设置第一行)。 */
function LanguageRow() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);
  const options = [
    { v: "auto", label: t("settings.language.auto") },
    // 语言名用各自的原文显示,不随界面语言翻译。
    { v: "zh", label: "简体中文" },
    { v: "zh-TW", label: "繁體中文" },
    { v: "ja", label: "日本語" },
    { v: "en", label: "English" },
  ] as const;
  const current = options.find((o) => o.v === language) ?? options[0];
  return (
    <Flex
      justify="space-between"
      align="center"
      gap={6}
      py={3}
      borderBottomWidth="1px"
      borderColor="border.subtle"
    >
      <Text fontSize="sm" color="fg.muted" flexShrink={0}>
        {t("settings.language.label")}
      </Text>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button size="xs" variant="outline" borderColor="border.subtle" fontWeight="normal" gap={1}>
            {current.label}
            <ChevronDown size={12} opacity={0.55} />
          </Button>
        </Menu.Trigger>
        <Portal>
          <Menu.Positioner zIndex={1000}>
            <Menu.Content
              minW="110px"
              bg="bg"
              borderWidth="1px"
              borderColor="border.subtle"
              borderRadius="10px"
              boxShadow="md"
              overflow="hidden"
              p={1}
            >
              <Menu.RadioItemGroup
                value={language}
                onValueChange={(e) => setLanguage(e.value as Language)}
              >
                {options.map((o) => (
                  <Menu.RadioItem
                    key={o.v}
                    value={o.v}
                    display="flex"
                    justifyContent="space-between"
                    fontSize="sm"
                    px={2}
                    py={1.5}
                    borderRadius="6px"
                  >
                    {o.label}
                    {language === o.v && <Check size={14} aria-hidden />}
                  </Menu.RadioItem>
                ))}
              </Menu.RadioItemGroup>
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>
    </Flex>
  );
}

/**
 * 设置弹窗:左侧导航(通用/外观/赞助/关于) + 右侧内容。
 * 背景半透明模糊;由首页左下角与顶栏"主题"左侧的设置按钮唤起。
 */
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [section, setSection] = useState<SectionId>("general");
  const contentRef = useRef<HTMLDivElement>(null);
  // 打开时模糊整个 App 内容(见 lib/overlayBlur.ts)。
  useOverlayBlur(open);

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
        <Dialog.Backdrop bg="blackAlpha.300" />
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
                aria-label={t("settings.close")}
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
                {visibleSections.map((s) => {
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
                      {t(s.labelKey)}
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
