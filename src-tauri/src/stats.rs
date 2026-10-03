//! 启动统计数据:首次启动上报一次版本与操作系统(参考 NexBox 的 sys_info.rs)。
//! 用 app_data_dir 下的 statistics-sent.json 标志,保证整个生命周期只发送一次。

use serde_json::json;
use tauri::Manager;

async fn send_statistics(version: String, os: String) {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    match client
        .post("https://mc.sjtu.cn/api-sjmcl/statistics")
        .json(&json!({
            "version": format!("OpenMD-{}", version),
            "os": os,
        }))
        .send()
        .await
    {
        Ok(resp) => eprintln!("[stats] statistics sent, status: {}", resp.status()),
        Err(e) => eprintln!("[stats] failed to send statistics: {}", e),
    }
}

/// 统计标志的独立文件路径(app_data_dir/statistics-sent.json)
fn statistics_flag_path(app_handle: &tauri::AppHandle) -> std::path::PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .unwrap_or_default()
        .join("statistics-sent.json")
}

/// 启动时调用:未发送过则后台异步上报并写入标志
pub fn check_and_send_statistics(app: &tauri::App) {
    let flag_path = statistics_flag_path(app.handle());
    if flag_path.exists() {
        return;
    }

    let version = env!("CARGO_PKG_VERSION").to_string();
    let os = std::env::consts::OS.to_string();
    eprintln!("[stats] sending statistics: version=OpenMD-{version}, os={os}");

    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        send_statistics(version, os).await;

        let flag_path = statistics_flag_path(&app_handle);
        if let Some(parent) = flag_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&flag_path, "1");
    });
}
