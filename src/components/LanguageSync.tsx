import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import i18n, { resolveLanguage } from "../i18n";
import { useSettings } from "../stores/settings";

/** Keeps i18next and the Rust backend locale in sync with the persisted setting. */
export default function LanguageSync() {
  const pref = useSettings((s) => s.language);
  useEffect(() => {
    const lang = resolveLanguage(pref);
    if (i18n.language !== lang) void i18n.changeLanguage(lang);
    invoke("set_language", { lang }).catch(() => {});
  }, [pref]);
  return null;
}
