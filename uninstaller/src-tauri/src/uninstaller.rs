use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::Command;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use winreg::enums::*;
use winreg::RegKey;

#[derive(Serialize)]
pub struct UninstallInfo {
    pub install_dir: String,
    pub app_name: String,
}

#[derive(Serialize)]
pub struct UninstallProgress {
    pub percent: u32,
    pub message: String,
    pub done: bool,
}

/// 归一化路径：去首尾空白、去尾部分隔符、转小写，用于安全比较
fn normalize_path(p: &str) -> String {
    p.trim().trim_end_matches(|c| c == '\\' || c == '/').to_lowercase()
}

const MD_PROG_ID: &str = "OpenMD.Markdown";
const MD_EXTENSIONS: [&str; 4] = [".md", ".markdown", ".mdown", ".mkd"];

/// 反注册文件关联:删除 ProgID 子树;扩展名默认值仅在仍指向我们时删除
fn unregister_file_association() -> Result<(), String> {
    let classes = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags("Software\\Classes", KEY_READ | KEY_WRITE)
        .map_err(|e| format!("打开注册表失败: {e}"))?;

    let _ = classes.delete_subkey_all(MD_PROG_ID);
    for ext in MD_EXTENSIONS {
        if let Ok(key) = classes.open_subkey_with_flags(ext, KEY_READ | KEY_WRITE) {
            let v: String = key.get_value("").unwrap_or_default();
            if v == MD_PROG_ID {
                let _ = key.delete_value("");
            }
        }
    }

    #[cfg(target_os = "windows")]
    unsafe {
        use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        SHChangeNotify(
            SHCNE_ASSOCCHANGED as i32,
            SHCNF_IDLIST,
            std::ptr::null(),
            std::ptr::null(),
        );
    }
    Ok(())
}

/// 判断目录是否为系统关键目录（盘根、Windows、Program Files、用户目录等）。
/// 命中则禁止删除，防止安装目录解析异常时误删整个系统/程序目录。
fn is_critical_dir(dir: &Path) -> bool {
    if dir.parent().is_none() {
        return true; // 文件系统根目录
    }
    let target = normalize_path(&dir.to_string_lossy());
    if target.is_empty() {
        return true;
    }
    let mut critical: Vec<String> = Vec::new();
    for var in [
        "SystemRoot",
        "windir",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramData",
        "USERPROFILE",
        "SystemDrive",
        "HomeDrive",
    ] {
        if let Ok(v) = std::env::var(var) {
            critical.push(normalize_path(&v));
        }
    }
    critical.iter().any(|c| !c.is_empty() && *c == target)
}

/// 权威安装目录来源：读取安装器写入注册表的 InstallLocation，
/// 不再使用 exe 所在目录，避免卸载器被复制/放置到其他软件目录时误删该目录。
/// require_app_exe=true 时额外要求目录内存在 OpenMD.exe（删除内容前的强校验）。
fn resolve_install_dir(require_app_exe: bool) -> Result<std::path::PathBuf, String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let reg_paths = [
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\OpenMD",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\OpenMD",
    ];

    let mut location: Option<String> = None;
    for rp in reg_paths {
        if let Ok(key) = hklm.open_subkey_with_flags(rp, KEY_READ) {
            if let Ok(loc) = key.get_value::<String, _>("InstallLocation") {
                if !loc.trim().is_empty() {
                    location = Some(loc);
                    break;
                }
            }
        }
    }

    let loc =
        location.ok_or("注册表中未找到 OpenMD 安装目录(InstallLocation)，已中止以防误删")?;
    let dir = Path::new(&loc).to_path_buf();

    if !dir.is_dir() {
        return Err(format!("安装目录不存在，已中止: {}", dir.display()));
    }
    if is_critical_dir(&dir) {
        return Err("安装目录指向系统关键路径，已中止卸载以防误删".to_string());
    }
    if require_app_exe && !dir.join("OpenMD.exe").is_file() {
        return Err("安装目录内未检测到 OpenMD.exe，已中止卸载以防误删".to_string());
    }
    Ok(dir)
}

#[tauri::command]
pub fn get_install_info() -> Result<UninstallInfo, String> {
    // 展示真实安装目录（来自注册表），与后续删除目标保持一致
    let install_dir = resolve_install_dir(false)?;

    Ok(UninstallInfo {
        install_dir: install_dir.display().to_string(),
        app_name: "OpenMD".to_string(),
    })
}

#[tauri::command]
pub fn start_uninstall() -> Result<UninstallProgress, String> {
    let exe_path = std::env::current_exe().map_err(|e| format!("获取路径失败: {}", e))?;
    // 安装目录以注册表为准，并强制校验目录内确有 OpenMD.exe，避免误删其他软件目录
    let install_dir = resolve_install_dir(true)?;

    // 1. Delete all files recursively (except self)
    delete_directory_contents(&install_dir, &exe_path)?;

    // 2. Delete Start Menu shortcut
    delete_shortcut("OpenMD", "StartMenu")
        .map_err(|e| eprintln!("删除开始菜单快捷方式失败: {}", e)).ok();

    // 3. Delete Desktop shortcut
    delete_shortcut("OpenMD", "Desktop")
        .map_err(|e| eprintln!("删除桌面快捷方式失败: {}", e)).ok();

    // 3.5 反注册文件关联(ProgID + 扩展名默认值)
    unregister_file_association()
        .map_err(|e| eprintln!("反注册文件关联失败: {}", e)).ok();

    // 4. Delete registry entry
    unregister_uninstall()
        .map_err(|e| eprintln!("删除注册表项失败: {}", e)).ok();

    Ok(UninstallProgress {
        percent: 100,
        message: "卸载完成".to_string(),
        done: true,
    })
}

#[tauri::command]
pub fn self_delete() -> Result<(), String> {
    let exe_path = std::env::current_exe().map_err(|e| format!("获取路径失败: {}", e))?;
    // 删除目标同样以注册表安装目录为准（此时 OpenMD.exe 已被清除，仅做关键目录护栏）
    let install_dir = resolve_install_dir(false)?;

    let temp_dir = std::env::temp_dir();
    let vbs_path = temp_dir.join("OpenMD_cleanup.vbs");

    let exe_str = exe_path.display().to_string();
    let dir_str = install_dir.display().to_string();

    let vbs_content = format!(
        r#"Set WMI = GetObject("winmgmts:root\cimv2")
Set Processes = WMI.ExecQuery("SELECT * FROM Win32_Process WHERE Name='uninstOpenMD.exe'")
For Each P In Processes
    P.Terminate()
Next
WScript.Sleep 3000
Set F = CreateObject("Scripting.FileSystemObject")
On Error Resume Next
F.DeleteFile "{}", True
F.DeleteFolder "{}", True
"#,
        exe_str, dir_str
    );

    // VBS 文件使用 UTF-16 LE + BOM 确保中文路径正确解析
    let mut vbs_bytes: Vec<u8> = vec![0xFF, 0xFE];
    for c in vbs_content.encode_utf16() {
        vbs_bytes.extend_from_slice(&c.to_le_bytes());
    }
    fs::write(&vbs_path, &vbs_bytes)
        .map_err(|e| format!("无法创建清理脚本: {}", e))?;

    #[cfg(target_os = "windows")]
    {
        const DETACHED_PROCESS: u32 = 0x00000008;
        Command::new("wscript.exe")
            .args(["//B", "//Nologo", &vbs_path.display().to_string()])
            .creation_flags(DETACHED_PROCESS)
            .spawn()
            .map_err(|e| format!("无法执行清理脚本: {}", e))?;
    }

    Ok(())
}

fn delete_directory_contents(dir: &Path, exclude: &Path) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }

    let entries = fs::read_dir(dir)
        .map_err(|e| format!("无法读取目录: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let path = entry.path();

        if path == exclude {
            continue;
        }

        if path.is_dir() {
            let _ = fs::remove_dir_all(&path);
        } else {
            let _ = fs::remove_file(&path);
        }
    }

    Ok(())
}

fn delete_shortcut(name: &str, location: &str) -> Result<(), String> {
    let folder = if location == "Desktop" {
        get_special_folder_path("Desktop")
    } else {
        get_special_folder_path("StartMenu")
    };

    let folder = folder.ok_or_else(|| "无法获取系统目录路径".to_string())?;
    let shortcut_path = format!("{}\\{}.lnk", folder, name);

    if Path::new(&shortcut_path).exists() {
        fs::remove_file(&shortcut_path)
            .map_err(|e| format!("无法删除快捷方式 {}: {}", shortcut_path, e))?;
    }

    Ok(())
}

fn get_special_folder_path(folder: &str) -> Option<String> {
    if folder == "Desktop" {
        dirs::desktop_dir().map(|p| p.to_string_lossy().to_string())
    } else {
        get_common_programs_path()
    }
}

#[cfg(target_os = "windows")]
fn get_common_programs_path() -> Option<String> {
    use std::os::windows::ffi::OsStringExt;

    extern "system" {
        fn SHGetFolderPathW(
            hwnd: *mut std::ffi::c_void,
            csidl: i32,
            h_token: *mut std::ffi::c_void,
            dw_flags: u32,
            psz_path: *mut u16,
        ) -> i32;
    }

    const CSIDL_COMMON_PROGRAMS: i32 = 0x0017;
    let mut buf = vec![0u16; 260]; // MAX_PATH

    unsafe {
        let result = SHGetFolderPathW(
            std::ptr::null_mut(),
            CSIDL_COMMON_PROGRAMS,
            std::ptr::null_mut(),
            0,
            buf.as_mut_ptr(),
        );
        if result == 0 {
            let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            return Some(std::ffi::OsString::from_wide(&buf[..len]).to_string_lossy().to_string());
        }
    }
    None
}

fn unregister_uninstall() -> Result<(), String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let uninstall_path = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\OpenMD";

    hklm.delete_subkey_all(uninstall_path)
        .map_err(|e| format!("无法删除注册表键: {}", e))?;

    // Also clean up old Inno Setup registry entries
    cleanup_old_innosetup_registry();

    Ok(())
}

/// Remove leftover Inno Setup uninstall registry entries.
/// This handles the case where a user installs the new version
/// over an old INNO installation without the installer catching it.
fn cleanup_old_innosetup_registry() {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    let hive_paths = [
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];

    for hive in &hive_paths {
        if let Ok(uninstall_key) = hklm.open_subkey_with_flags(hive, KEY_ALL_ACCESS) {
            let to_delete: Vec<String> = uninstall_key
                .enum_keys()
                .filter_map(|k| k.ok())
                .filter(|k| k.ends_with("_is1"))
                .filter(|key_name| {
                    if let Ok(subkey) =
                        uninstall_key.open_subkey_with_flags(key_name, KEY_READ)
                    {
                        if let Ok(name) = subkey.get_value::<String, _>("DisplayName") {
                            return name.contains("OpenMD")
                                || name.to_lowercase().contains("OpenMD");
                        }
                    }
                    false
                })
                .collect();

            for key_name in &to_delete {
                let _ = uninstall_key.delete_subkey_all(key_name);
            }
        }
    }
}
