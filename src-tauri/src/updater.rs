//! 应用内更新:下载 GitCode release 安装包(带进度事件)、重启安装。
//! 参考 NexBox 的 downloader.rs,精简为手动流程(无静默下载)。

use std::fs::File;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};

use futures_util::StreamExt;
use reqwest::Client;
use tauri::{AppHandle, Emitter, Window};

/// 取消下载标志:用户点"取消"时置位,下载循环据此中止
static CANCEL_DOWNLOAD: AtomicBool = AtomicBool::new(false);

#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    progress: u64,
    total: u64,
}

/// GitCode 资产 URL 可能落在 test.gitcode.net 等不可达 CDN 域名上,
/// 统一替换为主站域名,由其 302 重定向到可达的 file-cdn.gitcode.com。
fn normalize_gitcode_url(url: &str) -> String {
    url.replace("https://test.gitcode.net/", "https://gitcode.com/")
        .replace("https://download.gitcode.net/", "https://gitcode.com/")
}

/// 下载安装包到系统"下载"目录,按 200ms 节流推送 update-download-progress 事件。
#[tauri::command]
pub async fn download_update(url: String, file_name: String, window: Window) -> Result<String, String> {
    let client = Client::new();
    let url = normalize_gitcode_url(&url);
    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;

    let total_size = response.content_length().unwrap_or(0);
    if !response.status().is_success() {
        return Err(format!("Download failed (HTTP {})", response.status().as_u16()));
    }

    let download_path = match dirs::download_dir() {
        Some(mut path) => {
            path.push(file_name);
            path
        }
        None => {
            let mut path = std::env::current_dir().map_err(|e| e.to_string())?;
            path.push(file_name);
            path
        }
    };

    // 作用域内写文件:结束即 drop,确保返回前端前句柄已关闭
    {
        let mut file = File::create(&download_path).map_err(|e| e.to_string())?;
        let mut stream = response.bytes_stream();
        let mut downloaded: u64 = 0;
        let mut last_emit = std::time::Instant::now();
        let mut last_emitted: u64 = 0;

        while let Some(chunk) = stream.next().await {
            if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
                drop(file);
                let _ = std::fs::remove_file(&download_path);
                return Err("Download cancelled".to_string());
            }
            let chunk = chunk.map_err(|e| e.to_string())?;
            file.write_all(&chunk).map_err(|e| e.to_string())?;
            downloaded += chunk.len() as u64;

            let progress = if total_size > 0 {
                (downloaded * 100) / total_size
            } else {
                0
            };
            if progress != last_emitted && last_emit.elapsed().as_millis() >= 200 {
                last_emit = std::time::Instant::now();
                last_emitted = progress;
                let _ = window.emit(
                    "update-download-progress",
                    DownloadProgress { progress, total: total_size },
                );
            }
        }

        // 强制刷入磁盘,避免返回路径后文件尚未就绪
        file.sync_all().map_err(|e| e.to_string())?;

        // 完整性校验:声明了 Content-Length 时实际写入必须一致,残缺包直接删除
        if total_size > 0 && downloaded != total_size {
            drop(file);
            let _ = std::fs::remove_file(&download_path);
            return Err(format!("Download incomplete: expected {total_size}, got {downloaded}"));
        }
    }

    Ok(download_path.to_string_lossy().into_owned())
}

/// 轮询等待安装包落盘且句柄释放(杀软扫描/磁盘缓冲),最多约 3 秒。
fn wait_until_file_ready(file_path: &str) {
    for _ in 0..10 {
        match std::fs::OpenOptions::new().read(true).write(true).open(file_path) {
            Ok(f) => {
                drop(f);
                return;
            }
            Err(_) => std::thread::sleep(std::time::Duration::from_millis(300)),
        }
    }
}

/// 以 SW_SHOWNORMAL 启动安装向导(ShellExecuteW,无终端窗口)
#[cfg(target_os = "windows")]
fn launch_installer(file_path: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    wait_until_file_ready(file_path);

    let file_path_wide: Vec<u16> = file_path.encode_utf16().chain(std::iter::once(0)).collect();
    let verb: Vec<u16> = "open\0".encode_utf16().collect();
    let hinst = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file_path_wide.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if hinst as isize <= 32 {
        return Err(format!("Failed to launch installer (error: {})", hinst as isize));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn launch_installer(_file_path: &str) -> Result<(), String> {
    Err("Only Windows is supported".to_string())
}

/// 启动安装向导并退出应用
#[tauri::command]
pub async fn install_update(file_path: String, app_handle: AppHandle) -> Result<(), String> {
    launch_installer(&file_path)?;
    std::thread::sleep(std::time::Duration::from_millis(500));
    app_handle.exit(0);
    Ok(())
}

/// 用户点"取消":置位取消标志,进行中的下载中止并删除半成品
#[tauri::command]
pub fn cancel_download() -> Result<(), String> {
    CANCEL_DOWNLOAD.store(true, Ordering::SeqCst);
    Ok(())
}

/// 开始新下载前清除取消标志
#[tauri::command]
pub fn reset_download_cancel() -> Result<(), String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
    Ok(())
}

/// 删除已下载的安装包(用户在完成态点"取消")
#[tauri::command]
pub async fn delete_download_file(file_path: String) -> Result<(), String> {
    if std::path::Path::new(&file_path).exists() {
        std::fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
