use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// 官方 QQ 群配置文件地址(gitee 仓库 muliuawa/OpenMD)
const QQ_GROUPS_URL: &str =
    "https://raw.giteeusercontent.com/muliuawa/OpenMD/raw/master/qq_groups.json";
const CONNECT_TIMEOUT_SECS: u64 = 3;
const REQUEST_TIMEOUT_SECS: u64 = 6;
/// 内存缓存时长,避免每次打开设置页都请求 gitee
const MEMORY_CACHE_TTL_SECS: u64 = 600;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QqGroup {
    /// 群名,如 "①群"
    pub name: String,
    /// QQ 群号
    pub number: String,
    /// 加群链接(qm.qq.com),为空时前端退化为复制群号
    pub link: String,
    /// 群图标 URL(gitee raw),为空时前端使用默认 QQ 图标
    #[serde(default)]
    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QqGroupsPayload {
    #[serde(rename = "update_time", default)]
    pub update_time: String,
    #[serde(default)]
    pub groups: Vec<QqGroup>,
}

/// 内置兜底数据:gitee 拉取失败/为空时使用,保证功能可用
fn fallback_payload() -> QqGroupsPayload {
    QqGroupsPayload {
        update_time: String::new(),
        groups: vec![QqGroup {
            name: "①群".to_string(),
            number: "1028672542".to_string(),
            link: "https://qm.qq.com/q/arZ3C1IL6w".to_string(),
            icon: "https://gitee.com/muliuawa/nexbox/raw/master/qq_icons/group1.png".to_string(),
        }],
    }
}

static MEMORY_CACHE: OnceLock<Mutex<Option<(Instant, QqGroupsPayload)>>> = OnceLock::new();

async fn fetch_qq_groups() -> Result<QqGroupsPayload, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(QQ_GROUPS_URL)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    let data: QqGroupsPayload =
        serde_json::from_str(&text).map_err(|e| format!("JSON parse error: {e}"))?;

    if data.groups.is_empty() {
        return Err("gitee 文件为空".to_string());
    }
    Ok(data)
}

/// 获取官方 QQ 群列表:优先内存缓存,其次 gitee 配置,最后内置兜底
#[tauri::command]
pub async fn get_qq_groups() -> QqGroupsPayload {
    if let Some(cache) = MEMORY_CACHE.get() {
        if let Ok(guard) = cache.lock() {
            if let Some((at, data)) = guard.as_ref() {
                if at.elapsed() < Duration::from_secs(MEMORY_CACHE_TTL_SECS) {
                    return data.clone();
                }
            }
        }
    }

    match fetch_qq_groups().await {
        Ok(data) => {
            let cache = MEMORY_CACHE.get_or_init(|| Mutex::new(None));
            if let Ok(mut guard) = cache.lock() {
                *guard = Some((Instant::now(), data.clone()));
            }
            data
        }
        Err(e) => {
            eprintln!("[qq_group] fetch failed: {e}, using fallback");
            fallback_payload()
        }
    }
}

/// 后端下载群图标到应用缓存,返回本地文件路径(前端用 convertFileSrc 走 asset 协议显示)。
/// WebView 直连 gitee raw 图通常加载不出来,由后端下载最可靠,来源仍是 gitee(远程)。
#[tauri::command]
pub async fn get_qq_group_icon(app: AppHandle, url: String) -> Result<String, String> {
    if url.trim().is_empty() {
        return Ok(String::new());
    }

    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("qq_icons");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut hasher = DefaultHasher::new();
    url.hash(&mut hasher);
    let file = dir.join(format!("{:016x}.img", hasher.finish()));

    if !file.exists() {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(20))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 OpenMD")
            .build()
            .map_err(|e| format!("client error: {e}"))?;

        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("network error: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("icon http {}", resp.status()));
        }
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        std::fs::write(&file, &bytes).map_err(|e| e.to_string())?;
    }

    // 图标在缓存目录,不在 tauri.conf.json 的 asset scope 内,运行时按文件放行
    app.asset_protocol_scope()
        .allow_file(&file)
        .map_err(|e| format!("Failed to allow asset {}: {e}", file.display()))?;

    Ok(file.to_string_lossy().into_owned())
}
