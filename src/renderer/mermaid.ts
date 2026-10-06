/**
 * Mermaid 图表渲染:把预览里的 `pre > code.language-mermaid` 替换成渲染好的 SVG。
 *
 * 渲染故意放在 sanitize 之后的 DOM 后处理阶段(与复制按钮同一时机),而不是
 * 改渲染管线——mermaid 的 SVG 内嵌 <style>,DOMPurify 的 FORBID_TAGS 会剥掉它,
 * 管线里生成的 SVG 活不过 sanitize。CSP 允许内联样式,直接插 SVG 没有问题。
 *
 * mermaid 体积大,用动态 import 懒加载:vite 会把它拆成独立 chunk,文档里
 * 没有 mermaid 块就永远不会加载这份代码。
 *
 * 两段式:先同步把代码块换成空容器(源码存 data-mermaid-src),再异步填充。
 * 主题切换时后处理重跑,已渲染的容器也从源码重建(命中缓存,代价极低)。
 */
import type { Mermaid } from "mermaid";

let mermaidPromise: Promise<Mermaid> | null = null;
let initializedTheme: "dark" | "default" | null = null;
let seq = 0;

/** 渲染结果缓存(key = 主题:源码)。html 每次变化都会重跑后处理,同一张图
 *  不能反复走 mermaid.render(异步且不便宜)。超上限整体清空(长会话兜底)。 */
const CACHE_LIMIT = 200;
const svgCache = new Map<string, string>();
const errorCache = new Map<string, string>();

function cachePut(map: Map<string, string>, key: string, value: string) {
  if (map.size >= CACHE_LIMIT) map.clear();
  map.set(key, value);
}

async function getMermaid(dark: boolean): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  const mermaid = await mermaidPromise;
  const theme = dark ? "dark" : "default";
  if (initializedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      // strict:标签文本按纯文本处理——图表源码来自任意 markdown 文件
      securityLevel: "strict",
      // mermaid 默认会把错误图直接塞进 DOM,我们要自己画错误框
      suppressErrorRendering: true,
      theme,
      fontFamily: "'MiSans', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    });
    initializedTheme = theme;
  }
  return mermaid;
}

/** 同步阶段:代码块 → 带源码标记的空容器,返回待填充的容器列表。 */
function claimBlocks(root: HTMLElement): HTMLElement[] {
  // 先收集上次渲染遗留的容器(主题切换重跑时按存下的源码重建),
  // 再替换代码块,避免刚建的容器被下面两个查询重复收集。
  const claimed = Array.from(
    root.querySelectorAll<HTMLElement>(".md-mermaid[data-mermaid-src]"),
  );
  for (const code of Array.from(root.querySelectorAll("pre > code.language-mermaid"))) {
    const pre = code.parentElement;
    if (!pre) continue;
    const box = document.createElement("div");
    box.className = "md-mermaid";
    box.setAttribute("data-mermaid-src", code.textContent ?? "");
    // 继承源码行打标,块级寻址(滚动定位等)对渲染后的图依然有效
    for (const name of ["data-source-line", "data-source-end"]) {
      const v = code.getAttribute(name);
      if (v) box.setAttribute(name, v);
    }
    pre.replaceWith(box);
    claimed.push(box);
  }
  return claimed;
}

/**
 * 扫描 root 下所有 mermaid 代码块并渲染成 SVG。只在阅读态调用(编辑态保留
 * 可编辑代码块)。异步安全:await 之后发现容器已被下一次重渲染替换(脱离
 * 文档)就直接放弃,不会有旧图闪现。
 */
export async function renderMermaidBlocks(root: HTMLElement, dark: boolean): Promise<void> {
  const boxes = claimBlocks(root);
  if (boxes.length === 0) return;

  const mermaid = await getMermaid(dark).catch(() => null);
  for (const box of boxes) {
    const source = box.getAttribute("data-mermaid-src") ?? "";
    const key = `${dark ? "d" : "l"}:${source}`;

    let svg = svgCache.get(key);
    let error = svg === undefined ? errorCache.get(key) : undefined;
    if (svg === undefined && error === undefined) {
      if (mermaid) {
        try {
          const id = `openmd-mermaid-${seq++}`;
          svg = (await mermaid.render(id, source)).svg;
          cachePut(svgCache, key, svg);
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          cachePut(errorCache, key, error);
        }
      } else {
        error = "Failed to load mermaid";
      }
    }

    // await 期间文档可能已被重渲染替换,旧节点脱离文档就不再动它。
    if (!box.isConnected) continue;
    box.textContent = "";
    if (error !== undefined) {
      box.classList.add("md-mermaid-error");
      const label = document.createElement("div");
      label.className = "md-mermaid-error-label";
      label.textContent = "Mermaid";
      const msg = document.createElement("pre");
      msg.textContent = error;
      box.append(label, msg);
    } else if (svg !== undefined) {
      box.classList.remove("md-mermaid-error");
      box.innerHTML = svg;
    }
  }
}
