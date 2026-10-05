//! 系统托盘:左键单击显示主窗口,右键菜单(显示主窗口 / 检查更新 / 退出)。

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

/// 显示并聚焦主窗口(托盘唤起 / 第二实例转发文件时使用)。
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let check_update = MenuItem::with_id(app, "check-update", "检查更新", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &check_update, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
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
    #[cfg(target_os = "macos")]
    {
        // macOS 菜单栏要的是单色 template 图标:系统按 template 语义自动适配
        // 深浅色,彩色应用图标在菜单栏里会显得脏。Windows/Linux 仍用应用图标。
        // 资源是预先离线生成的 36×36 原始 RGBA(18pt @2x),这样不必为 tauri
        // 打开 image-png feature,也不必在启动时做 PNG 解码。
        const TRAY_ICON_RGBA: &[u8] = include_bytes!("../icons/tray-template.rgba");
        const TRAY_ICON_SIZE: u32 = 36;
        let icon = tauri::image::Image::new_owned(
            TRAY_ICON_RGBA.to_vec(),
            TRAY_ICON_SIZE,
            TRAY_ICON_SIZE,
        );
        builder = builder.icon(icon).icon_as_template(true);
    }
    builder.build(app)?;
    Ok(())
}
