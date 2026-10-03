//! 运行时文件关联:把 OpenMD 注册为 .md 等扩展名的打开方式(HKCU,无需管理员权限)。
//! 采用标准 ProgID 方案(绿色版/开发版同样可用);不触碰 FileExts\UserChoice(Win10+ 哈希保护)。

/// 关联文件的图标(由 file.png 转换的多尺寸 ico;Windows 注册表图标不支持 PNG)
const MD_FILE_ICON_BYTES: &[u8] = include_bytes!("../icons/md-file.ico");

/// 我们的 ProgID 标识
const PROG_ID: &str = "OpenMD.Markdown";
const PROG_DESC: &str = "OpenMD Markdown Document";
const EXTENSIONS: [&str; 4] = [".md", ".markdown", ".mdown", ".mkd"];

#[cfg(windows)]
mod imp {
    use super::{EXTENSIONS, MD_FILE_ICON_BYTES, PROG_DESC, PROG_ID};
    use std::path::PathBuf;
    use tauri::Manager;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;

    fn classes_root() -> winreg::RegKey {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags("Software\\Classes", KEY_READ | KEY_WRITE)
            .expect("HKCU\\Software\\Classes 必定存在")
    }

    /// 把内嵌图标写到应用数据目录,返回其路径
    fn write_icon(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
        let dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("无法定位应用数据目录: {e}"))?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let icon_path = dir.join("md-file.ico");
        std::fs::write(&icon_path, MD_FILE_ICON_BYTES).map_err(|e| e.to_string())?;
        Ok(icon_path)
    }

    fn current_exe() -> Result<PathBuf, String> {
        std::env::current_exe().map_err(|e| format!("无法获取程序路径: {e}"))
    }

    /// 资源管理器刷新图标/关联缓存
    fn notify_shell() {
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
    }

    pub fn is_associated() -> bool {
        let Ok(classes) = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey("Software\\Classes\\.md")
        else {
            return false;
        };
        let v: String = classes.get_value("").unwrap_or_default();
        v == PROG_ID
    }

    pub fn register(app_handle: &tauri::AppHandle) -> Result<(), String> {
        let exe = current_exe()?;
        let icon_path = write_icon(app_handle)?;
        let classes = classes_root();

        // ProgID 主键
        let (prog, _) = classes
            .create_subkey(PROG_ID)
            .map_err(|e| format!("写入注册表失败: {e}"))?;
        prog.set_value("", &PROG_DESC).map_err(|e| e.to_string())?;
        prog.create_subkey("DefaultIcon")
            .map_err(|e| format!("写入注册表失败: {e}"))?
            .0
            .set_value("", &format!("\"{}\",0", icon_path.display()))
            .map_err(|e| e.to_string())?;
        prog.create_subkey("shell\\open\\command")
            .map_err(|e| format!("写入注册表失败: {e}"))?
            .0
            .set_value("", &format!("\"{}\" \"%1\"", exe.display()))
            .map_err(|e| e.to_string())?;

        // 扩展名 → ProgID
        for ext in EXTENSIONS {
            let (key, _) = classes
                .create_subkey(ext)
                .map_err(|e| format!("写入注册表失败: {e}"))?;
            key.set_value("", &PROG_ID).map_err(|e| e.to_string())?;
        }

        notify_shell();
        Ok(())
    }

    pub fn unregister() -> Result<(), String> {
        let classes = classes_root();

        // 删除 ProgID 整棵子键
        classes
            .delete_subkey_all(PROG_ID)
            .map_err(|e| format!("删除注册表失败: {e}"))?;

        // 扩展名默认值仅在仍指向我们时才删除,不破坏其他软件的关联
        for ext in EXTENSIONS {
            if let Ok(key) = classes.open_subkey_with_flags(ext, KEY_READ | KEY_WRITE) {
                let v: String = key.get_value("").unwrap_or_default();
                if v == PROG_ID {
                    if let Err(e) = key.delete_value("") {
                        return Err(format!("删除注册表值失败: {e}"));
                    }
                }
            }
        }

        notify_shell();
        Ok(())
    }
}

#[tauri::command]
pub fn is_md_associated() -> bool {
    #[cfg(windows)]
    return imp::is_associated();
    #[cfg(not(windows))]
    false
}

#[tauri::command]
pub fn register_md_association(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    return imp::register(&app);
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("仅支持 Windows".to_string())
    }
}

#[tauri::command]
pub fn unregister_md_association() -> Result<(), String> {
    #[cfg(windows)]
    return imp::unregister();
    #[cfg(not(windows))]
    Err("仅支持 Windows".to_string())
}
