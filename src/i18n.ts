import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { useSettings } from "./stores/settings";
import zhShell from "./locales/zh/shell.json";
import zhTabs from "./locales/zh/tabs.json";
import zhSettings from "./locales/zh/settings.json";
import zhMisc from "./locales/zh/misc.json";
import zhStores from "./locales/zh/stores.json";
import zhViewer from "./locales/zh/viewer.json";
import zhRenderer from "./locales/zh/renderer.json";
import zhTwShell from "./locales/zh-TW/shell.json";
import zhTwTabs from "./locales/zh-TW/tabs.json";
import zhTwSettings from "./locales/zh-TW/settings.json";
import zhTwMisc from "./locales/zh-TW/misc.json";
import zhTwStores from "./locales/zh-TW/stores.json";
import zhTwViewer from "./locales/zh-TW/viewer.json";
import zhTwRenderer from "./locales/zh-TW/renderer.json";
import jaShell from "./locales/ja/shell.json";
import jaTabs from "./locales/ja/tabs.json";
import jaSettings from "./locales/ja/settings.json";
import jaMisc from "./locales/ja/misc.json";
import jaStores from "./locales/ja/stores.json";
import jaViewer from "./locales/ja/viewer.json";
import jaRenderer from "./locales/ja/renderer.json";
import enShell from "./locales/en/shell.json";
import enTabs from "./locales/en/tabs.json";
import enSettings from "./locales/en/settings.json";
import enMisc from "./locales/en/misc.json";
import enStores from "./locales/en/stores.json";
import enViewer from "./locales/en/viewer.json";
import enRenderer from "./locales/en/renderer.json";

export type AppLanguage = "zh" | "zh-TW" | "ja" | "en";

const CONCRETE_LANGUAGES: readonly AppLanguage[] = ["zh", "zh-TW", "ja", "en"];

export function resolveLanguage(pref: string): AppLanguage {
  if (CONCRETE_LANGUAGES.includes(pref as AppLanguage)) return pref as AppLanguage;
  const sys = navigator.language.toLowerCase();
  if (sys.startsWith("zh")) {
    // 繁体地区(TW/HK/MO/Hant)走繁体,其余中文走简体。
    return /-(tw|hk|mo|hant)/.test(sys) ? "zh-TW" : "zh";
  }
  return sys.startsWith("ja") ? "ja" : "en";
}

const zh = {
  ...zhShell,
  ...zhTabs,
  ...zhSettings,
  ...zhMisc,
  ...zhStores,
  ...zhViewer,
  ...zhRenderer,
};
const zhTW = {
  ...zhTwShell,
  ...zhTwTabs,
  ...zhTwSettings,
  ...zhTwMisc,
  ...zhTwStores,
  ...zhTwViewer,
  ...zhTwRenderer,
};
const ja = {
  ...jaShell,
  ...jaTabs,
  ...jaSettings,
  ...jaMisc,
  ...jaStores,
  ...jaViewer,
  ...jaRenderer,
};
const en = {
  ...enShell,
  ...enTabs,
  ...enSettings,
  ...enMisc,
  ...enStores,
  ...enViewer,
  ...enRenderer,
};

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    "zh-TW": { translation: zhTW },
    ja: { translation: ja },
    en: { translation: en },
  },
  lng: resolveLanguage(useSettings.getState().language),
  fallbackLng: "zh",
  interpolation: { escapeValue: false },
});

export default i18n;
