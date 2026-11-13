import DOMPurify from "dompurify";

let hooksInstalled = false;

/**
 * DOMPurify's default protocol allowlist plus `file:`.
 *
 * Links to Windows absolute paths are rewritten to `file:///F:/…` by the renderer
 * (see `windowsPathToFileUrl`), because `F:` on its own reads as an unknown URI
 * scheme and the href would be dropped. `file:` is therefore allowed for
 * navigation — and only for navigation: the hook below strips it from media
 * attributes, so local images still have to go through the asset allowlist.
 */
const ALLOWED_URI =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|file):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/** Attributes the webview loads by itself — never allowed to point at `file:`. */
const MEDIA_URL_ATTRS = ["src", "srcset", "poster"];

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;

  DOMPurify.addHook("uponSanitizeElement", (node) => {
    if (!(node instanceof Element) || node.tagName.toLowerCase() !== "iframe") return;
    node.setAttribute("sandbox", "allow-same-origin");
    node.setAttribute("referrerpolicy", "no-referrer");
  });

  // `file:` 只放行给用户点击的链接。图片/音视频的 src 若指向 file://,webview 会
  // 自己去读本地文件,绕过 asset 白名单——这里直接摘掉。
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof Element)) return;
    for (const attr of MEDIA_URL_ATTRS) {
      const value = node.getAttribute(attr);
      if (value && /^\s*file:/i.test(value)) node.removeAttribute(attr);
    }
  });
}

/**
 * Preserve arbitrary HTML/CSS/SVG/MathML while keeping script execution off.
 * This is deliberately broader than DOMPurify's default allowlist: unknown
 * tags and attributes pass, but script tags, event handlers, srcdoc and unsafe
 * URL protocols do not.
 */
export function sanitizeHtml(raw: string): string {
  installHooks();
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: () => true,
    ADD_ATTR: (name) => !/^on/i.test(name) && name.toLowerCase() !== "srcdoc",
    FORBID_TAGS: ["script"],
    FORBID_ATTR: ["srcdoc"],
    ALLOW_UNKNOWN_PROTOCOLS: false,
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    KEEP_CONTENT: true,
  });
}
