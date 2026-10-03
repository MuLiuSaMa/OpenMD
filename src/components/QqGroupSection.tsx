import { useEffect, useState } from "react";
import { Box, Flex, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { FaQq } from "react-icons/fa6";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getQqGroupIcon, getQqGroups, type QqGroup, type QqGroupsData } from "../tauri/api";

const QQ_BLUE = "#12B7F5";

/** 群图标:后端下载到缓存后走 asset 协议显示,失败/缺省退化为 QQ 图标 */
function GroupIcon({ url }: { url?: string }) {
  const [src, setSrc] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(undefined);
    setFailed(false);
    if (!url) return;
    let alive = true;
    getQqGroupIcon(url)
      .then((path) => {
        if (alive && path) setSrc(convertFileSrc(path));
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  if (!url || failed || !src) {
    return <FaQq size={22} color={QQ_BLUE} />;
  }
  return (
    <img
      src={src}
      alt="群图标"
      draggable={false}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
      onError={() => setFailed(true)}
    />
  );
}

/** 单个群卡片:点击整卡跳转加群链接,群号旁的复制按钮复制群号 */
function QqGroupCard({ group }: { group: QqGroup }) {
  const [copied, setCopied] = useState(false);

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(group.number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      console.error("复制群号失败");
    }
  };

  const openJoin = async () => {
    if (!group.link) {
      void copyNumber();
      return;
    }
    try {
      await openUrl(group.link);
    } catch {
      window.open(group.link, "_blank");
    }
  };

  return (
    <HStack
      gap={3}
      p={3}
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="8px"
      cursor="pointer"
      transition="all 0.2s"
      _hover={{ bg: "bg.subtle" }}
      onClick={() => void openJoin()}
    >
      <Box
        w="40px"
        h="40px"
        borderRadius="8px"
        overflow="hidden"
        bg="bg.subtle"
        display="flex"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
      >
        <GroupIcon url={group.icon} />
      </Box>
      <VStack align="start" gap={0} flex={1} minW={0}>
        <Text fontSize="sm" fontWeight="medium" truncate>
          {group.name}
        </Text>
        <HStack gap={1}>
          <Text fontSize="xs" color="fg.muted" fontVariantNumeric="tabular-nums">
            群号:{group.number}
          </Text>
          <Box
            as="button"
            aria-label={`复制群号 ${group.number}`}
            title="复制群号"
            display="flex"
            alignItems="center"
            color={copied ? "green.500" : "fg.muted"}
            cursor="pointer"
            transition="color 0.2s"
            _hover={{ color: "fg" }}
            onClick={(e) => {
              e.stopPropagation();
              void copyNumber();
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </Box>
          {copied && (
            <Text fontSize="xs" color="green.500">
              已复制
            </Text>
          )}
        </HStack>
      </VStack>
      <Box color="fg.muted" flexShrink={0}>
        <ExternalLink size={15} />
      </Box>
    </HStack>
  );
}

/** 设置页「QQ群」板块:群列表来自 gitee 的 qq_groups.json,由后端拉取(含内置兜底) */
export function QqGroupSection() {
  const [data, setData] = useState<QqGroupsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getQqGroups()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setData({ update_time: "", groups: [] });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <Flex justify="center" py={10}>
        <HStack gap={2}>
          <Spinner size="sm" />
          <Text fontSize="sm" color="fg.muted">
            加载中...
          </Text>
        </HStack>
      </Flex>
    );
  }

  if (!data || data.groups.length === 0) {
    return (
      <Flex justify="center" py={10}>
        <Text fontSize="sm" color="fg.muted">
          暂无 QQ 群数据
        </Text>
      </Flex>
    );
  }

  return (
    <VStack align="stretch" gap={3} pt={2}>
      {data.groups.map((group) => (
        <QqGroupCard key={`${group.number}-${group.name}`} group={group} />
      ))}
      {data.update_time && (
        <Text fontSize="xs" color="fg.muted" textAlign="center">
          数据更新于 {data.update_time}
        </Text>
      )}
    </VStack>
  );
}
