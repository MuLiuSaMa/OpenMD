use std::collections::BTreeSet;

/// 枚举当前操作系统已安装的字体家族名称（去重并按字典序排列）。
#[tauri::command]
pub fn list_system_fonts() -> Vec<String> {
    list_system_fonts_impl()
}

#[cfg(target_os = "windows")]
fn list_system_fonts_impl() -> Vec<String> {
    use windows_sys::Win32::Graphics::Gdi::{
        EnumFontFamiliesExW, GetDC, ReleaseDC, DEFAULT_CHARSET, ENUMLOGFONTEXW, LOGFONTW,
        TEXTMETRICW,
    };

    unsafe extern "system" fn enum_proc(
        lpelfe: *const LOGFONTW,
        _lpntme: *const TEXTMETRICW,
        _font_type: u32,
        lparam: isize,
    ) -> i32 {
        if lpelfe.is_null() || lparam == 0 {
            return 1;
        }
        let elf = &*(lpelfe as *const ENUMLOGFONTEXW);
        let raw = &elf.elfLogFont.lfFaceName;
        let len = raw.iter().position(|&c| c == 0).unwrap_or(raw.len());
        let name = String::from_utf16_lossy(&raw[..len]).trim().to_string();
        // 跳过 Windows 纵向字体（@ 前缀）与空名称
        if !name.is_empty() && !name.starts_with('@') {
            let set = &mut *(lparam as *mut BTreeSet<String>);
            set.insert(name);
        }
        1
    }

    let mut set = BTreeSet::<String>::new();
    unsafe {
        let hdc = GetDC(std::ptr::null_mut());
        if !hdc.is_null() {
            let mut lf: LOGFONTW = std::mem::zeroed();
            lf.lfCharSet = DEFAULT_CHARSET as u8;
            EnumFontFamiliesExW(
                hdc,
                &lf,
                Some(enum_proc),
                (&mut set as *mut BTreeSet<String>) as isize,
                0,
            );
            ReleaseDC(std::ptr::null_mut(), hdc);
        }
    }
    set.into_iter().collect()
}

#[cfg(not(target_os = "windows"))]
fn list_system_fonts_impl() -> Vec<String> {
    let mut set = BTreeSet::<String>::new();
    if let Ok(out) = std::process::Command::new("fc-list")
        .args([":", "family"])
        .output()
    {
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                for part in line.split(',') {
                    let name = part.trim();
                    if !name.is_empty() && !name.starts_with('.') {
                        set.insert(name.to_string());
                    }
                }
            }
        }
    }
    set.into_iter().collect()
}
