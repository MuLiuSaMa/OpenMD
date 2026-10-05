//! 系统托盘:左键单击显示主窗口,右键菜单(显示主窗口 / 检查更新 / 退出)。

use rust_i18n::t;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

/// 托盘图标 id(切换语言重建菜单时按此查找)。
pub const TRAY_ID: &str = "main-tray";

/// 显示并聚焦主窗口(托盘唤起 / 第二实例转发文件时使用)。
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 按当前语言构建托盘右键菜单。
pub fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(app, "show", t!("tray.show"), true, None::<&str>)?;
    let check_update = MenuItem::with_id(app, "check-update", t!("tray.check_update"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", t!("tray.quit"), true, None::<&str>)?;
    Menu::with_items(app, &[&show, &check_update, &quit])
}

/// 用当前语言重建托盘菜单(set_language 切换语言后调用,托盘原地刷新)。
pub fn refresh_tray_menu(app: &AppHandle) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let menu = build_tray_menu(app)?;
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_tray_menu(app)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        // 左键留给"显示主窗口",右键才弹菜单
        .show_menu_on_left_click(false)
        .tooltip("OpenMD")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            // 检查更新由前端执行(复用更新弹窗与提示逻辑)
            "check-update" => {
                let _ = app.emit("tray-check-update", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
