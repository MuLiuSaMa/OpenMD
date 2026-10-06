import DOMPurify from "dompurify";

let iframeHookInstalled = false;

function installIframeHook() {
  if (iframeHookInstalled) return;
  iframeHookInstalled = true;
  DOMPurify.addHook("uponSanitizeElement", (node) => {
    if (!(node instanceof Element) || node.tagName.toLowerCase() !== "iframe") return;
    node.setAttribute("sandbox", "allow-same-origin");
    node.setAttribute("referrerpolicy", "no-referrer");
  });
}

/**
 * Preserve arbitrary HTML/CSS/SVG/MathML while keeping script execution off.
 * This is deliberately broader than DOMPurify's default allowlist: unknown
 * tags and attributes pass, but script tags, event handlers, srcdoc and unsafe
 * URL protocols do not.
 */
export function sanitizeHtml(raw: string): string {
  installIframeHook();
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: () => true,
    ADD_ATTR: (name) => !/^on/i.test(name) && name.toLowerCase() !== "srcdoc",
    FORBID_TAGS: ["script"],
    FORBID_ATTR: ["srcdoc"],
    ALLOW_UNKNOWN_PROTOCOLS: false,
    KEEP_CONTENT: true,
  });
}
