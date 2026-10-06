/**
 * 构建期标志:商店版(MSIX)构建。
 *
 * 由 `pnpm build:store`(vite build --mode store,读取 .env.store)注入。
 * 微软商店政策 10.1.5 / 10.2.3 要求产品不得引导用户到商店之外获取、安装
 * 非商店分发的软件,因此商店版隐藏作者平台入口、QQ 群、赞助页,并关闭
 * 应用内「检查更新→下载安装」(更新由商店接管)。
 */
export const IS_STORE_BUILD = import.meta.env.VITE_STORE_BUILD === "true";
