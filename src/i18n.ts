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
import enShell from "./locales/en/shell.json";
import enTabs from "./locales/en/tabs.json";
import enSettings from "./locales/en/settings.json";
import enMisc from "./locales/en/misc.json";
import enStores from "./locales/en/stores.json";
import enViewer from "./locales/en/viewer.json";
import enRenderer from "./locales/en/renderer.json";

export type AppLanguage = "zh" | "en";

export function resolveLanguage(pref: string): AppLanguage {
  if (pref === "zh" || pref === "en") return pref;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
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
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng: resolveLanguage(useSettings.getState().language),
  fallbackLng: "zh",
  interpolation: { escapeValue: false },
});

export default i18n;
