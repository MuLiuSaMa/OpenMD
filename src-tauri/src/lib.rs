mod commands;
mod editors;
mod file_assoc;
mod qq_group;
mod stats;
mod tray;
mod updater;
mod watcher;

use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Stores file paths received from OS "Open With" events / argv.
/// These can arrive before the webview is ready, so we buffer them.
pub struct OpenedFiles {
    pub paths: Mutex<Vec<String>>,
}

impl Default for OpenedFiles {
    fn default() -> Self {
        Self {
            paths: Mutex::new(Vec::new()),
        }
    }
}

/// 诊断日志:追加到 app_data_dir/assoc-debug.log(排查"双击 .md 打不开"用)
pub fn debug_log(app: &AppHandle, msg: &str) {
    use std::io::Write;
    let Some(dir) = app.path().app_data_dir().ok() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("assoc-debug.log"))
    else {
        return;
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = writeln!(f, "[{ts}] {msg}");
}

/// Drain the buffered open requests. The frontend calls this once at startup;
/// afterwards it listens to the `opened-files` event instead.
#[tauri::command]
fn get_opened_files(state: tauri::State<'_, OpenedFiles>, app: AppHandle) -> Vec<String> {
    let mut paths = state.paths.lock().unwrap();
    let result = paths.clone();
    paths.clear();
    debug_log(&app, &format!("get_opened_files drained: {result:?}"));
    result
}

/// Buffer file paths and notify the frontend. Always buffering (even when the
/// webview looks ready) keeps this race-free: a path that arrives before the
/// listener registers is drained by the startup `get_opened_files` call.
fn push_opened_files(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        debug_log(app, "push_opened_files: paths EMPTY, skipped");
        return;
    }
    if let Some(state) = app.try_state::<OpenedFiles>() {
        if let Ok(mut buf) = state.paths.lock() {
            buf.extend(paths.clone());
            debug_log(app, &format!("push_opened_files buffered: {paths:?}"));
        }
    }
    match app.emit("opened-files", &paths) {
        Ok(_) => debug_log(app, "push_opened_files emitted opened-files OK"),
        Err(e) => debug_log(app, &format!("push_opened_files emit FAILED: {e}")),
    }
}

/// Extract markdown file paths from process argv (Windows "Open With" hands
/// the file as argv[1]). Only existing files with a markdown extension pass.
fn collect_md_args<I: Iterator<Item = String>>(args: I) -> Vec<String> {
    args.skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| {
            if Path::new(&a).is_absolute() {
                a
            } else {
                // Dragging a file onto the exe can hand a bare relative name.
                std::env::current_dir()
                    .map(|d| d.join(&a).to_string_lossy().into_owned())
                    .unwrap_or(a)
            }
        })
        .filter(|a| {
            Path::new(a)
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| {
                    matches!(
                        e.to_ascii_lowercase().as_str(),
                        "md" | "markdown" | "mdown" | "mkd"
                    )
                })
                .unwrap_or(false)
        })
        .filter(|a| Path::new(a).is_file())
        .collect()
}

/// 隐藏主窗口到系统托盘(前端关闭询问对话框选择"隐藏到托盘"时调用)。
#[tauri::command]
fn hide_to_tray(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

/// 真正退出程序(托盘菜单"退出"与前端关闭询问对话框选择"退出"共用)。
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let md_args = collect_md_args(std::env::args());

    tauri::Builder::default()
        // 窗口状态插件默认会恢复上次保存的 decorations 标记,导致
        // tauri.conf.json 里的 decorations:false 失效;排除该字段。
        // 同时排除 VISIBLE:从托盘隐藏后退出,下次启动不应保持隐藏。
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::DECORATIONS
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch (e.g. "Open With" while running) forwards its
            // files here instead of starting a new process.
            debug_log(app, &format!("single_instance argv: {argv:?}"));
            let paths = collect_md_args(argv.into_iter());
            debug_log(app, &format!("single_instance filtered: {paths:?}"));
            push_opened_files(app, paths);
            // 若窗口在托盘里,第二实例唤起时顺便显示主窗口
            tray::show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(watcher::WatcherState::default())
        .manage(OpenedFiles {
            paths: Mutex::new(md_args),
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_markdown_file,
            commands::write_markdown_file,
            commands::resolve_path,
            commands::path_exists,
            commands::allow_assets,
            editors::detect_editors,
            editors::open_file_with,
            watcher::watch_file,
            watcher::unwatch_file,
            watcher::stop_watching,
            get_opened_files,
            hide_to_tray,
            quit_app,
            commands::log_assoc,
            updater::download_update,
            updater::install_update,
            updater::cancel_download,
            updater::reset_download_cancel,
            updater::delete_download_file,
            file_assoc::is_md_associated,
            file_assoc::register_md_association,
            file_assoc::unregister_md_association,
            qq_group::get_qq_groups,
            qq_group::get_qq_group_icon,
        ])
        .on_window_event(|window, event| {
            // 拦截所有关闭请求(点 X / Alt+F4):交给前端弹出询问对话框
            // (隐藏到托盘 还是 退出)。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .setup(|app| {
            // 首次启动上报统计(版本 + 操作系统,仅一次)
            stats::check_and_send_statistics(app);

            // 系统托盘
            tray::create_tray(app.handle())?;

            // 窗口以 visible:false 隐藏创建,先恢复上次的位置/尺寸再显示,
            // 避免出现"先在屏幕中央、再跳到上次位置"的闪烁。
            use tauri_plugin_window_state::WindowExt;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.restore_state(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::DECORATIONS
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                );
                let _ = window.show();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
