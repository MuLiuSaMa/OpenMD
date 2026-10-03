/**
 * GitCode 检查更新(参考 NexBox 的 update-checker)。
 * release 接口必须携带只读令牌走认证,否则匿名请求会被限流。
 * 该令牌无写权限,公开仓库下不存在额外风险。
 */

const GITCODE_OWNER = "MuLiuSaMa";
const GITCODE_REPO = "OpenMD";
const GITCODE_WEB = "https://gitcode.com";
const GITCODE_READ_TOKEN = "gxaYRxdjeeVEzFags7ZaqDsM";

export interface ReleaseInfo {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  assets?: Array<{ name: string; browser_download_url: string }>;
}

const releaseBaseUrl = (path: string, query = "") =>
  `https://api.gitcode.com/api/v5/repos/${GITCODE_OWNER}/${GITCODE_REPO}${path}${query}`;

// GitCode 的 release 响应不含顶层 html_url,按仓库与 tag 拼接
function releaseHtmlUrl(tagName: string): string {
  return `${GITCODE_WEB}/${GITCODE_OWNER}/${GITCODE_REPO}/releases/tag/${tagName}`;
}

const authenticatedHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${GITCODE_READ_TOKEN}`,
});

export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const response = await fetch(releaseBaseUrl("/releases/latest"), {
      headers: authenticatedHeaders(),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return { ...data, html_url: releaseHtmlUrl(data.tag_name) };
  } catch {
    return null;
  }
}

/** latest 是否比 current 新(语义化版本比较,忽略前导 v)。 */
export function compareVersions(current: string, latest: string): boolean {
  const currentParts = current.replace(/^v/, "").split(".").map(Number);
  const latestParts = latest.replace(/^v/, "").split(".").map(Number);

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const c = currentParts[i] || 0;
    const l = latestParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}
