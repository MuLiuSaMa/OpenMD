import { renderMermaidBlocks } from "./mermaid";
import { sanitizeHtml } from "./sanitize";
import { dirnameOf, renderFull } from "./pipeline";
import { allowAssets, resolveWikiTarget } from "../tauri/api";
import { convertFileSrc } from "@tauri-apps/api/core";

type RichKind = "graphviz" | "vega" | "vega-lite" | "chart";

const RICH_LANGUAGES: Record<string, RichKind> = {
  graphviz: "graphviz",
  dot: "graphviz",
  vega: "vega",
  "vega-lite": "vega-lite",
  vegalite: "vega-lite",
  chart: "chart",
  chartjs: "chart",
  "chart.js": "chart",
};

function baseName(kind: RichKind): string {
  switch (kind) {
    case "graphviz":
      return "Graphviz";
    case "vega":
      return "Vega";
    case "vega-lite":
      return "Vega-Lite";
    case "chart":
      return "Chart.js";
  }
}

function showRichError(box: HTMLElement, label: string, error: unknown) {
  box.classList.add("md-rich-error");
  box.textContent = "";
  const title = document.createElement("div");
  title.className = "md-rich-error-label";
  title.textContent = label;
  const message = document.createElement("pre");
  message.textContent = error instanceof Error ? error.message : String(error);
  box.append(title, message);
}

function replaceCodeBlocks(root: HTMLElement): { box: HTMLElement; kind: RichKind; source: string }[] {
  const claimed: { box: HTMLElement; kind: RichKind; source: string }[] = [];
  for (const code of Array.from(root.querySelectorAll("pre > code"))) {
    const className = code.getAttribute("class") ?? "";
    const match = /language-([\w.-]+)/i.exec(className);
    const kind = match ? RICH_LANGUAGES[match[1].toLowerCase()] : undefined;
    if (!kind) continue;
    const pre = code.parentElement;
    if (!pre) continue;
    const box = document.createElement("div");
    box.className = "md-rich md-rich-" + kind;
    box.setAttribute("data-rich-kind", kind);
    box.setAttribute("data-rich-src", code.textContent ?? "");
    for (const name of ["data-source-line", "data-source-end"]) {
      const value = code.getAttribute(name);
      if (value) box.setAttribute(name, value);
    }
    claimed.push({ box, kind, source: code.textContent ?? "" });
    pre.replaceWith(box);
  }
  return claimed;
}

async function renderGraphviz(box: HTMLElement, source: string, dark: boolean) {
  const wasm = (await import("@hpcc-js/wasm/graphviz")) as any;
  const Graphviz = wasm.Graphviz;
  const graphviz = await Graphviz.load();
  let svg = graphviz.dot(source) as string;
  if (dark) {
    // Graphviz paints its own white background polygon; drop it so the diagram
    // sits on the document background like Mermaid does.
    svg = svg.replace(/fill="white"/, 'fill="transparent"');
  }
  box.innerHTML = sanitizeHtml(svg);
}

async function renderVega(box: HTMLElement, source: string, dark: boolean) {
  const embed = (await import("vega-embed")).default;
  const spec = JSON.parse(source) as Record<string, any>;
  // Responsive sizing: Vega fills the container instead of a fixed pixel width
  // that CSS would then scale a second time.
  spec.width = "container";
  spec.autosize = { type: "fit", contains: "padding" };
  // Keep categorical axis labels horizontal; Vega-Lite's default auto-rotation
  // stacks CJK labels vertically once the band width is computed early.
  const encoding = spec.encoding;
  if (encoding && typeof encoding === "object") {
    for (const channel of ["x", "y"]) {
      const enc = encoding[channel];
      if (enc && typeof enc === "object" && (enc.type === "nominal" || enc.type === "ordinal")) {
        enc.axis = { labelAngle: 0, ...(typeof enc.axis === "object" ? enc.axis : {}) };
      }
    }
  }
  await embed(box, spec, {
    actions: false,
    renderer: "svg",
    tooltip: false,
    theme: dark ? "dark" : undefined,
    config: { background: "transparent" },
  });
  box.innerHTML = sanitizeHtml(box.innerHTML);
}

async function renderChart(box: HTMLElement, source: string) {
  const { Chart, registerables } = await import("chart.js");
  Chart.register(...registerables);
  const spec = JSON.parse(source) as { type: string; data: unknown; options?: unknown };
  const canvas = document.createElement("canvas");
  box.appendChild(canvas);
  new Chart(canvas, {
    type: spec.type,
    data: spec.data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      ...(typeof spec.options === "object" && spec.options !== null ? spec.options : {}),
    },
  } as never);
}

/**
 * Async post-render pass for every rich Markdown block. Mermaid is handed off
 * to its existing renderer; Graphviz, Vega/Vega-Lite and Chart.js are loaded
 * lazily so documents without them never pay the bundle cost.
 */
export interface RichBlockOptions {
  root?: string;
  fromPath?: string;
}

interface WikiOptions extends RichBlockOptions {
  depth: number;
  visited: Set<string>;
}

export async function renderRichBlocks(
  root: HTMLElement,
  dark: boolean,
  options: RichBlockOptions = {},
): Promise<void> {
  await renderRichBlocksInternal(root, dark, { ...options, depth: 0, visited: new Set() });
}

const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;
const MAX_EMBED_DEPTH = 2;

async function renderWikiEmbeds(root: HTMLElement, options: WikiOptions) {
  if (!options.root || !options.fromPath || options.depth >= MAX_EMBED_DEPTH) return;
  const embeds = Array.from(root.querySelectorAll<HTMLElement>(".wiki-embed"));
  for (const el of embeds) {
    const target = el.getAttribute("data-wiki-target");
    const section = el.getAttribute("data-wiki-section") ?? undefined;
    if (!target) continue;
    try {
      const query = section ? `${target}#${section}` : target;
      const resolution = await resolveWikiTarget(options.root, options.fromPath, query);
      if (!resolution.path) {
        el.classList.add("wiki-embed-missing");
        continue;
      }
      const path = resolution.path;
      if (IMAGE_EXTENSIONS.test(path)) {
        const img = document.createElement("img");
        img.alt = path.split(/[\\/]/).pop() || el.textContent?.trim() || target;
        img.setAttribute("data-original-src", target);
        // Asset scope must be granted before the webview requests the file,
        // otherwise the first request is refused and <img> never retries.
        await allowAssets(options.fromPath, [path]).catch(() => {});
        img.src = convertFileSrc(path);
        el.replaceWith(img);
        continue;
      }
      // Guard against cycles: a document cannot embed itself transitively.
      if (options.visited.has(path)) {
        el.classList.add("wiki-embed-cycle");
        continue;
      }
      const source = resolution.section ?? resolution.content;
      if (!source) continue;
      const visited = new Set(options.visited);
      visited.add(path);
      const rendered = renderFull(source, dirnameOf(path));
      el.classList.add("wiki-embed-doc");
      el.innerHTML = rendered.html;
      await allowAssets(path, rendered.assetPaths).catch(() => {});
      await renderRichBlocksInternal(el, document.documentElement.classList.contains("dark"), {
        root: options.root,
        fromPath: path,
        depth: options.depth + 1,
        visited,
      });
    } catch (error) {
      el.classList.add("wiki-embed-missing");
      console.error("wiki embed failed:", target, error);
    }
  }
}

async function renderRichBlocksInternal(
  root: HTMLElement,
  dark: boolean,
  options: WikiOptions,
): Promise<void> {
  await renderMermaidBlocks(root, dark);
  await renderWikiEmbeds(root, options);

  const blocks = replaceCodeBlocks(root);
  for (const { box, kind, source } of blocks) {
    try {
      if (kind === "graphviz") await renderGraphviz(box, source, dark);
      else if (kind === "vega" || kind === "vega-lite") await renderVega(box, source, dark);
      else await renderChart(box, source);
    } catch (error) {
      showRichError(box, baseName(kind), error);
    }
  }
}
