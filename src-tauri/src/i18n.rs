//! zh/en 本地化:翻译文件在 locales/{zh,en}.yml(编译期嵌入,见 lib.rs 里的
//! rust_i18n::i18n! 调用,fallback 为 zh)。界面语言由前端驱动:启动及用户
//! 切换语言时前端调用 set_language 命令,后端据此刷新托盘菜单等原生 UI。

use tauri::AppHandle;

/// 切换后端当前语言("zh" 或 "en"),并用新语言重建托盘菜单,无需重启即可生效。
#[tauri::command]
pub fn set_language(app: AppHandle, lang: String) {
    rust_i18n::set_locale(if lang == "en" { "en" } else { "zh" });
    let _ = crate::tray::refresh_tray_menu(&app);
}
