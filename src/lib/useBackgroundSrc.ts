import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { allowAssets } from "../tauri/api";

/**
 * 把本地图片路径转成 webview 里可用的 src。
 *
 * 资源协议的白名单只是运行时状态,重启后失效,因此每次路径变化都要重新放行;
 * 浏览器预览 / 文件已被删除时静默降级为 null(调用方按"无背景"处理)。
 *
 * 放行方式:把图片自身当作 `allow_assets` 的"文档路径",它的父目录会成为
 * 可放行根,于是任意位置选中的图片都能通过。
 */
export function useBackgroundSrc(path: string | null): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setSrc(null);
      return;
    }
    let alive = true;
    allowAssets(path, [path])
      .then(() => {
        if (alive) setSrc(convertFileSrc(path));
      })
      .catch(() => {
        if (alive) setSrc(null);
      });
    return () => {
      alive = false;
    };
  }, [path]);

  return src;
}
