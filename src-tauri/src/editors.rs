//! “用其他程序打开”菜单的数据源:扫描系统里能打开 Markdown 的程序。
//!
//! Windows 两个来源取并集:
//! 1. `.md`(及 markdown/mdown/mkd)的关联信息:HKCR 与 HKCU FileExts 下的
//!    默认 ProgID / OpenWithList / OpenWithProgids / UserChoice——即系统
//!    “打开方式”的推荐栏加上用户历史上用过的程序。标记为 `recommended`,
//!    菜单里排在前面。
//! 2. `HKCR\Applications` 里能对上已知编辑器/IDE 关键字的条目——让装了但没
//!    关联 .md 的 IDE 也能出现。全量枚举会把播放器、网盘之类无关应用带进来,
//!    所以这里按 exe 文件名关键字过滤(见 [`imp::EDITOR_EXE_KEYWORDS`])。
//!
//! macOS 没有注册表,实现见下方 `#[cfg(target_os = "macos")] mod imp`:扫描
//! `/Applications`、`/System/Applications`、`~/Applications`、
//! `/System/Library/CoreServices` 下的 `.app`,读 `Contents/Info.plist` 的
//! `CFBundleDocumentTypes` 判断应用是否真的声明了 Markdown,并叠加 Launch
//! Services 的默认 Markdown 处理程序(用户偏好 plist)。`exe` 取 bundle 内
//! `Contents/MacOS` 下的可执行文件,取不到时退回 `.app` 本身,交给
//! `/usr/bin/open -a` 启动;图标不提取(前端回退通用图标)。
//!
//! 每个条目解析出真实 exe 路径与友好名称(Windows 的 FriendlyAppName /
//! FriendlyTypeName,“@file,-idx” 间接字符串经 SHLoadIndirectString 还原),
//! 同时提取 exe 图标转成 PNG data URL(进程内缓存),排除 OpenMD 自身后按
//! “推荐在前、名称排序”返回。

use rust_i18n::t;
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct EditorApp {
    pub name: String,
    pub exe: String,
    /// exe 图标的 PNG data URL;提取失败为 null(前端回退到通用图标)。
    pub icon: Option<String>,
    /// 该程序关联了 .md(或用户最近用它打开过),菜单排在前面。
    pub recommended: bool,
}

#[tauri::command]
pub fn detect_editors() -> Vec<EditorApp> {
    #[cfg(windows)]
    {
        imp::detect_editors_impl()
    }
    #[cfg(target_os = "macos")]
    {
        imp::detect_editors_impl()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Vec::new()
    }
}

/// 用选中的程序打开文件。绑定目标必须存在且可启动,防止前端被诱导拼出任意
/// 命令;文件必须存在。Windows 上目标必须是 .exe,macOS 上必须是 `.app`
/// bundle(或 bundle 内 `Contents/MacOS/` 下的可执行文件)。
#[tauri::command]
pub fn open_file_with(exe: String, path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Windows 分支的校验顺序保持原样。
        let exe_path = Path::new(&exe);
        if !exe_path.is_file() {
            return Err(t!("editors.exe_not_found", exe = exe).into_owned());
        }
        let is_exe = exe_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("exe"))
            .unwrap_or(false);
        if !is_exe {
            return Err(t!("editors.not_executable", exe = exe).into_owned());
        }
        if !Path::new(&path).is_file() {
            return Err(t!("editors.file_not_found", path = path).into_owned());
        }
        std::process::Command::new(exe_path)
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| t!("editors.launch_failed", exe = exe, error = e).into_owned())
    }

    #[cfg(target_os = "macos")]
    {
        if !Path::new(&path).is_file() {
            return Err(t!("editors.file_not_found", path = path).into_owned());
        }
        imp::launch_macos(&exe, &path)
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = Path::new(&exe);
        let _ = &path;
        Err(t!("editors.unsupported_platform").into_owned())
    }
}

#[cfg(windows)]
mod imp {
    use super::EditorApp;
    use rust_i18n::t;
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};
    use winreg::enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    /// 支持“用其他程序打开”的扩展名(与前端 MARKDOWN_EXTENSIONS 一致)。
    const MD_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd"];

    /// `HKCR\Applications` 条目的白名单关键字:只有 exe 文件名能对上这些
    /// 编辑器/IDE 特征的应用才会进入菜单,避免全量枚举混入播放器等无关程序。
    /// .md 关联来源(来源 1)不受此过滤。
    ///
    /// 匹配规则:exe 主名按空格/下划线/连字符切分成 token,每个 token 去掉
    /// 尾部数字后与 TOKENS 精确相等,或包含 CONTAINS 中的无歧义长名。
    /// 这样 “codec_checker”(ToDesk)、“Uninstall ZCode” 不会被 “code” 误匹配。
    const EDITOR_EXE_TOKENS: &[&str] = &[
        "code", "vscode", "cursor", "zed", "vim", "gvim", "nvim", "neovim", "idea",
        "studio", "devenv", "fleet", "rider", "typora", "notepad", "notepad++",
        "sublime_text", "emacs", "runemacs", "devecostudio", "hbuilderx", "marktext",
        "obsidian", "logseq", "joplin", "zettlr",
    ];
    const EDITOR_EXE_CONTAINS: &[&str] = &[
        "pycharm", "webstorm", "windsurf", "vscodium", "intellij", "phpstorm",
        "rubymine", "datagrip", "rustrover", "goland", "clion", "codebuddy", "trae",
        "qoder", "hbuilder", "sublime",
    ];

    pub(super) fn is_editor_exe(file_name: &str) -> bool {
        let Some((stem, ext)) = file_name.rsplit_once('.') else {
            return false;
        };
        if !ext.eq_ignore_ascii_case("exe") {
            return false;
        }
        stem.to_lowercase()
            .split([' ', '_', '-', '.'])
            .any(|token| {
                let token = token.trim_end_matches(|c: char| c.is_ascii_digit());
                if token.is_empty() {
                    return false;
                }
                EDITOR_EXE_TOKENS.iter().any(|kw| *kw == token)
                    || EDITOR_EXE_CONTAINS.iter().any(|kw| token.contains(kw))
            })
    }

    /// 卸载表 DisplayName 匹配用的编辑器名称关键字。
    const EDITOR_NAME_KEYWORDS: &[&str] = &[
        "visual studio code", "vs code", "vscodium", "cursor", "windsurf", "trae",
        "qoder", "sublime", "notepad++", "intellij", "pycharm", "webstorm", "clion",
        "goland", "rustrover", "phpstorm", "rubymine", "datagrip", "rider",
        "android studio", "deveco", "hbuilder", "typora", "obsidian", "marktext",
        "logseq", "joplin", "zed", "emacs", "neovim", "fleet",
    ];

    pub(super) fn is_editor_display_name(name: &str) -> bool {
        let n = name.to_lowercase();
        EDITOR_NAME_KEYWORDS.iter().any(|kw| n.contains(kw))
    }

    /// “TraeCode CN (User)” → “TraeCode CN”:去掉安装器附加的范围后缀。
    pub(super) fn clean_display_name(name: &str) -> String {
        let mut n = name.trim().to_string();
        for suffix in ["(User)", "(Machine)"] {
            if let Some(stripped) = n.strip_suffix(suffix) {
                n = stripped.trim_end().to_string();
            }
        }
        n
    }

    #[derive(Clone)]
    pub(super) struct Candidate {
        pub(super) exe: PathBuf,
        pub(super) name: Option<String>,
        pub(super) recommended: bool,
    }

    pub fn detect_editors_impl() -> Vec<EditorApp> {
        let own = std::env::current_exe()
            .ok()
            .and_then(|p| std::fs::canonicalize(p).ok());
        let mut cands = Vec::new();
        for ext in MD_EXTENSIONS {
            collect_extension_candidates(ext, &mut cands);
        }
        collect_applications_candidates(&mut cands);
        collect_uninstall_candidates(&mut cands);
        collect_drive_root_candidates(&mut cands);
        merge(cands, own.as_deref())
    }

    /// 收集某个扩展名在系统里的关联程序(推荐来源)。
    fn collect_extension_candidates(ext: &str, out: &mut Vec<Candidate>) {
        // HKCR\.md:默认 ProgID + OpenWithList(裸 exe 名)+ OpenWithProgids
        if let Some(k) = open_class(&format!(".{ext}")) {
            if let Ok(progid) = k.get_value::<String, _>("") {
                resolve_progid(&progid, true, out);
            }
            if let Ok(owl) = k.open_subkey("OpenWithList") {
                for exe_name in owl.enum_keys().flatten() {
                    resolve_bare_exe(&exe_name, true, out);
                }
            }
            if let Ok(owp) = k.open_subkey("OpenWithProgids") {
                for (name, _) in owp.enum_values().flatten() {
                    resolve_progid(&name, true, out);
                }
            }
        }
        // HKCU FileExts\.md:用户的“打开方式”历史与当前选择
        let fe = format!(
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.{ext}"
        );
        if let Ok(k) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(&fe) {
            if let Ok(owl) = k.open_subkey("OpenWithList") {
                for exe_name in owl.enum_keys().flatten() {
                    resolve_bare_exe(&exe_name, true, out);
                }
            }
            if let Ok(owp) = k.open_subkey("OpenWithProgids") {
                for (name, _) in owp.enum_values().flatten() {
                    resolve_progid(&name, true, out);
                }
            }
            if let Ok(uc) = k.open_subkey("UserChoice") {
                if let Ok(progid) = uc.get_value::<String, _>("ProgId") {
                    resolve_progid(&progid, true, out);
                }
            }
        }
    }

    /// 卸载表:安装了但没写 Applications 注册的编辑器(绿色版/自定义路径)。
    /// 残留条目(DisplayIcon 指向不存在的 exe)由 merge 的存在性检查过滤。
    fn collect_uninstall_candidates(out: &mut Vec<Candidate>) {
        let sources = [
            (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            (HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        ];
        for (hive, sub) in sources {
            let Ok(root) = RegKey::predef(hive).open_subkey(sub) else {
                continue;
            };
            for key in root.enum_keys().flatten() {
                let Ok(k) = root.open_subkey(&key) else {
                    continue;
                };
                let display: String = k.get_value("DisplayName").unwrap_or_default();
                if !is_editor_display_name(&display) {
                    continue;
                }
                let name = clean_display_name(&display);
                if let Ok(icon) = k.get_value::<String, _>("DisplayIcon") {
                    if let Some(exe) = parse_exe_from_command(&icon) {
                        let fname = exe.file_name().and_then(|s| s.to_str()).unwrap_or_default();
                        if exe.is_file() && is_editor_exe(fname) {
                            out.push(Candidate {
                                exe,
                                name: Some(name.clone()),
                                recommended: false,
                            });
                            continue;
                        }
                    }
                }
                // DisplayIcon 缺失或指向卸载器:在 InstallLocation 下扫一层。
                if let Ok(loc) = k.get_value::<String, _>("InstallLocation") {
                    let loc = expand_env(loc.trim().trim_matches('"'));
                    if loc.is_empty() {
                        continue;
                    }
                    let Ok(rd) = std::fs::read_dir(&loc) else {
                        continue;
                    };
                    for entry in rd.flatten() {
                        let p = entry.path();
                        if !p.is_file() {
                            continue;
                        }
                        let fname = p.file_name().and_then(|s| s.to_str()).unwrap_or_default();
                        if is_editor_exe(fname) {
                            out.push(Candidate {
                                exe: p,
                                name: Some(name.clone()),
                                recommended: false,
                            });
                            break;
                        }
                    }
                }
            }
        }
    }

    /// 根目录扫描要跳过的系统目录(注册表来源已覆盖其中的正常安装)。
    const SYSTEM_ROOT_DIRS: &[&str] = &[
        "windows", "program files", "program files (x86)", "users", "$recycle.bin",
        "system volume information", "perflogs", "recovery",
    ];

    /// 各固定盘根目录向下两层的浅扫描:捕捉完全无注册的绿色版编辑器
    /// (如 D:\Microsoft VS Code\Code.exe)。只认编辑器 exe 名,不会引入垃圾;
    /// 显示名取所在文件夹名(如 “Microsoft VS Code”)。
    fn collect_drive_root_candidates(out: &mut Vec<Candidate>) {
        for drive in fixed_drives() {
            let Ok(roots) = std::fs::read_dir(&drive) else {
                continue;
            };
            let mut scanned = 0usize;
            for dir in roots.flatten() {
                let p = dir.path();
                let dir_name = p.file_name().and_then(|s| s.to_str()).unwrap_or_default();
                if scanned >= 200
                    || !p.is_dir()
                    || SYSTEM_ROOT_DIRS.contains(&dir_name.to_lowercase().as_str())
                {
                    continue;
                }
                scanned += 1;
                let Ok(inner) = std::fs::read_dir(&p) else {
                    continue;
                };
                for entry in inner.flatten() {
                    let ep = entry.path();
                    if !ep.is_file() {
                        continue;
                    }
                    let Some(fname) = ep.file_name().and_then(|s| s.to_str()) else {
                        continue;
                    };
                    if is_editor_exe(fname) {
                        let name = p.file_name().and_then(|s| s.to_str()).map(|s| s.to_string());
                        out.push(Candidate {
                            exe: ep,
                            name,
                            recommended: false,
                        });
                    }
                }
            }
        }
    }

    fn fixed_drives() -> Vec<PathBuf> {
        use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDriveStringsW};
        use windows_sys::Win32::System::WindowsProgramming::DRIVE_FIXED;
        let mut buf = [0u16; 512];
        let len = unsafe { GetLogicalDriveStringsW(buf.len() as u32, buf.as_mut_ptr()) };
        if len == 0 || len as usize >= buf.len() {
            return Vec::new();
        }
        let list = String::from_utf16_lossy(&buf[..len as usize]);
        list.split('\0')
            .filter(|d| !d.is_empty())
            .map(PathBuf::from)
            .filter(|d| {
                let wide: Vec<u16> = d
                    .as_os_str()
                    .to_str()
                    .unwrap_or_default()
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .collect();
                unsafe { GetDriveTypeW(wide.as_ptr()) == DRIVE_FIXED }
            })
            .collect()
    }

    /// `HKCR\Applications`:按编辑器关键字过滤后的已注册应用。
    fn collect_applications_candidates(out: &mut Vec<Candidate>) {
        let Ok(apps) = RegKey::predef(HKEY_CLASSES_ROOT).open_subkey("Applications") else {
            return;
        };
        for name in apps.enum_keys().flatten() {
            if !is_editor_exe(&name) {
                continue;
            }
            let Ok(k) = apps.open_subkey(&name) else {
                continue;
            };
            let cmd = k
                .open_subkey(r"shell\open\command")
                .and_then(|ck| ck.get_value::<String, _>(""))
                .unwrap_or_default();
            let Some(exe) = parse_exe_from_command(&cmd) else {
                continue;
            };
            let fname = k
                .get_value::<String, _>("FriendlyAppName")
                .ok()
                .and_then(resolve_friendly);
            out.push(Candidate {
                exe,
                name: fname,
                recommended: false,
            });
        }
    }

    /// 解析一个 ProgID 的打开命令与名称。`DelegateExecute` 形式(UWP 代理,
    /// 如新版记事本)无法直接以 exe 启动,跳过。
    fn resolve_progid(progid: &str, recommended: bool, out: &mut Vec<Candidate>) {
        if progid.is_empty() {
            return;
        }
        // Applications\x.exe 形式的 ProgID 没有独立 shell 键时按裸 exe 处理。
        let open_key = open_class(&format!(r"{progid}\shell\open"));
        let Some(k) = open_key else {
            if let Some(exe_name) = progid.strip_prefix("Applications\\") {
                resolve_bare_exe(exe_name, recommended, out);
            }
            return;
        };
        if k.get_value::<String, _>("DelegateExecute").is_ok() {
            return;
        }
        let cmd: String = k.get_value("").unwrap_or_default();
        let Some(exe) = parse_exe_from_command(&cmd) else {
            return;
        };
        let progid_key = open_class(progid);
        let name = progid_key
            .as_ref()
            .and_then(|pk| pk.get_value::<String, _>("FriendlyTypeName").ok())
            .and_then(resolve_friendly)
            .or_else(|| progid_key.as_ref().and_then(friendly_app_name));
        out.push(Candidate {
            exe,
            name,
            recommended,
        });
    }

    /// 解析一个裸 exe 名(OpenWithList 子键):优先 HKCR\Applications,
    /// 其次 App Paths,最后 system32 兜底(notepad.exe 等)。
    fn resolve_bare_exe(exe_name: &str, recommended: bool, out: &mut Vec<Candidate>) {
        let exe_name = exe_name.trim().trim_start_matches('\\').to_lowercase();
        if exe_name.is_empty() || !exe_name.ends_with(".exe") {
            return;
        }
        let app_key = open_class(&format!(r"Applications\{exe_name}"));
        if let Some(k) = &app_key {
            if let Ok(cmd) = k
                .open_subkey(r"shell\open\command")
                .and_then(|ck| ck.get_value::<String, _>(""))
            {
                if let Some(exe) = parse_exe_from_command(&cmd) {
                    let name = app_key.as_ref().and_then(friendly_app_name);
                    out.push(Candidate {
                        exe,
                        name,
                        recommended,
                    });
                    return;
                }
            }
        }
        for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
            let ap = format!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe_name}");
            if let Ok(k) = RegKey::predef(hive).open_subkey(&ap) {
                if let Ok(default) = k.get_value::<String, _>("") {
                    if let Some(exe) = parse_exe_from_command(&default) {
                        out.push(Candidate {
                            exe,
                            name: None,
                            recommended,
                        });
                        return;
                    }
                }
            }
        }
        if let Some(win) = std::env::var_os("SystemRoot") {
            let p = PathBuf::from(win).join(r"system32").join(&exe_name);
            if p.is_file() {
                out.push(Candidate {
                    exe: p,
                    name: None,
                    recommended,
                });
            }
        }
    }

    fn open_class(path: &str) -> Option<RegKey> {
        RegKey::predef(HKEY_CLASSES_ROOT).open_subkey(path).ok()
    }

    fn friendly_app_name(k: &RegKey) -> Option<String> {
        let v = k.get_value::<String, _>("FriendlyAppName").ok()?;
        resolve_friendly(v)
    }

    /// FriendlyTypeName / FriendlyAppName 可能是 “@file,-idx” 间接字符串,
    /// 经 shlwapi 还原成可读名称。
    fn resolve_friendly(v: String) -> Option<String> {
        let v = v.trim().to_string();
        if v.is_empty() {
            return None;
        }
        match v.strip_prefix('@') {
            Some(indirect) => load_indirect_string(indirect),
            None => Some(v),
        }
    }

    fn load_indirect_string(s: &str) -> Option<String> {
        use windows_sys::Win32::UI::Shell::SHLoadIndirectString;
        let wide: Vec<u16> = s.encode_utf16().chain(std::iter::once(0)).collect();
        let mut buf = [0u16; 512];
        let hr = unsafe {
            SHLoadIndirectString(
                wide.as_ptr(),
                buf.as_mut_ptr(),
                (buf.len() - 1) as u32,
                std::ptr::null_mut(),
            )
        };
        if hr < 0 {
            return None;
        }
        let end = buf.iter().position(|&c| c == 0)?;
        let out = String::from_utf16_lossy(&buf[..end]);
        let out = out.trim().to_string();
        (!out.is_empty()).then_some(out)
    }

    /// 从 open 命令串提取 exe 路径。带引号取引号内;不带引号取到第一个
    /// “.exe”为止。%VAR% 展开后交由存在性检查兜底。
    pub fn parse_exe_from_command(cmd: &str) -> Option<PathBuf> {
        let cmd = cmd.trim();
        if cmd.is_empty() {
            return None;
        }
        let raw = if let Some(rest) = cmd.strip_prefix('"') {
            let end = rest.find('"')? + 1;
            &rest[..end - 1]
        } else {
            let lower = cmd.to_lowercase();
            let idx = lower.find(".exe")? + 4;
            &cmd[..idx]
        };
        let raw = raw.trim();
        if !raw.to_lowercase().ends_with(".exe") {
            return None;
        }
        Some(PathBuf::from(expand_env(raw)))
    }

    /// 展开 %VAR% 形式的环境变量;未知变量原样保留(之后的存在性检查会过滤)。
    pub fn expand_env(s: &str) -> String {
        if !s.contains('%') {
            return s.to_string();
        }
        let mut out = String::with_capacity(s.len());
        let mut rest = s;
        while let Some(start) = rest.find('%') {
            out.push_str(&rest[..start]);
            let after = &rest[start + 1..];
            match after.find('%') {
                Some(end) => match std::env::var(&after[..end]) {
                    Ok(v) => {
                        out.push_str(&v);
                        rest = &after[end + 1..];
                    }
                    Err(_) => {
                        out.push('%');
                        rest = after;
                    }
                },
                None => {
                    out.push('%');
                    rest = after;
                }
            }
        }
        out.push_str(rest);
        out
    }

    /// 菜单显示名兜底:exe 文件名去扩展名,JetBrains 系的 “idea64” 去掉 64。
    pub fn stem_name(exe: &Path) -> String {
        let stem = exe
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| t!("editors.fallback_name").into_owned());
        match stem.strip_suffix("64") {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => stem,
        }
    }

    /// 同类应用名称归一:目前只处理 VS Code 家族(“Microsoft Visual Studio
    /// Code” / “VS Code” / “Microsoft VS Code” 都归为 “Visual Studio Code”),
    /// 避免同一应用的两个安装版本在菜单里出现两条。
    pub(super) fn canonical_editor_name(name: &str) -> String {
        let lower = name.to_lowercase();
        if lower.contains("visual studio code")
            || lower.contains("vs code")
            || lower.contains("vscode")
        {
            "Visual Studio Code".to_string()
        } else {
            name.to_string()
        }
    }

    /// 同名候选二选一时的优先级:exe 主名(token 去尾部数字)能对上编辑器
    /// 关键字的更规范(如 Code.exe 优于被改名的 new_Code.exe)。
    fn exe_canonical_score(exe: &Path) -> u8 {
        let stem = exe
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_lowercase();
        let trimmed = stem.trim_end_matches(|c: char| c.is_ascii_digit());
        if EDITOR_EXE_TOKENS.contains(&trimmed) {
            1
        } else {
            0
        }
    }

    /// 规范化、去重(按 canonical exe 与归一化显示名)、排除自身,推荐在前、名称排序。
    /// own_exe 内部同样做 canonicalize,接受任意形式的路径。
    pub fn merge(cands: Vec<Candidate>, own_exe: Option<&Path>) -> Vec<EditorApp> {
        let own = own_exe.and_then(|p| std::fs::canonicalize(p).ok());
        let mut seen: Vec<PathBuf> = Vec::new();
        let mut names: Vec<String> = Vec::new();
        let mut out: Vec<EditorApp> = Vec::new();
        for c in cands {
            let Ok(can) = std::fs::canonicalize(&c.exe) else {
                continue;
            };
            if !can.is_file() {
                continue;
            }
            if let Some(own) = &own {
                if can == *own {
                    continue;
                }
            }
            if seen.contains(&can) {
                continue;
            }
            let name = canonical_editor_name(&c.name.unwrap_or_else(|| stem_name(&can)));
            // 同名(归一化后)视为同一应用:已存在时,仅在新区表的 exe 更规范
            // (如 Code.exe 优于 new_Code.exe)时替换。
            if let Some(pos) = names.iter().position(|n| n.eq_ignore_ascii_case(&name)) {
                if exe_canonical_score(&c.exe) > exe_canonical_score(Path::new(&out[pos].exe)) {
                    seen[pos] = can;
                    out[pos].exe = c.exe.to_string_lossy().into_owned();
                    out[pos].icon = editor_icon(&c.exe);
                }
                continue;
            }
            seen.push(can);
            names.push(name.clone());
            let icon = editor_icon(&c.exe);
            out.push(EditorApp {
                name,
                exe: c.exe.to_string_lossy().into_owned(),
                icon,
                recommended: c.recommended,
            });
        }
        out.sort_by(|a, b| {
            b.recommended
                .cmp(&a.recommended)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        out
    }

    // ---- exe 图标 → PNG data URL(带进程内缓存) ----

    fn icon_cache() -> &'static Mutex<HashMap<PathBuf, Option<String>>> {
        static CACHE: OnceLock<Mutex<HashMap<PathBuf, Option<String>>>> = OnceLock::new();
        CACHE.get_or_init(|| Mutex::new(HashMap::new()))
    }

    /// 提取 exe 图标并编码为 PNG data URL。结果(含失败)按路径缓存,
    /// 菜单反复打开不会重复做 GDI 提取。
    pub fn editor_icon(exe: &Path) -> Option<String> {
        let key = std::fs::canonicalize(exe).unwrap_or_else(|_| exe.to_path_buf());
        let mut guard = icon_cache().lock().ok()?;
        if let Some(hit) = guard.get(&key) {
            return hit.clone();
        }
        let extracted = extract_icon_png(exe);
        guard.insert(key, extracted.clone());
        extracted
    }

    fn extract_icon_png(exe: &Path) -> Option<String> {
        let png = std::panic::catch_unwind(|| extract_icon_png_inner(exe))
            .ok()
            .flatten()?;
        Some(format!(
            "data:image/png;base64,{}",
            base64_encode(&png)
        ))
    }

    fn extract_icon_png_inner(exe: &Path) -> Option<Vec<u8>> {
        use windows_sys::Win32::Graphics::Gdi::{
            CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, GetObjectW,
            ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        };
        use windows_sys::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
        use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo};

        let text = exe.to_str()?;
        let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let mut sfi: SHFILEINFOW = std::mem::zeroed();
            let ok = SHGetFileInfoW(
                wide.as_ptr(),
                0,
                &mut sfi,
                std::mem::size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_LARGEICON,
            );
            if ok == 0 || sfi.hIcon.is_null() {
                return None;
            }
            let out = (|| {
                let mut ii: windows_sys::Win32::UI::WindowsAndMessaging::ICONINFO =
                    std::mem::zeroed();
                if GetIconInfo(sfi.hIcon, &mut ii) == 0 || ii.hbmColor.is_null() {
                    return None;
                }
                let mut bm: BITMAP = std::mem::zeroed();
                if GetObjectW(
                    ii.hbmColor,
                    std::mem::size_of::<BITMAP>() as i32,
                    &mut bm as *mut _ as *mut _,
                ) == 0
                {
                    return None;
                }
                let (w, h) = (bm.bmWidth, bm.bmHeight);
                if w <= 0 || h <= 0 || w > 128 || h > 128 {
                    return None;
                }
                let (w, h) = (w as usize, h as usize);
                let hdc = GetDC(std::ptr::null_mut());
                let memdc = CreateCompatibleDC(hdc);

                let mut bmi: BITMAPINFO = std::mem::zeroed();
                bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
                bmi.bmiHeader.biWidth = w as i32;
                bmi.bmiHeader.biHeight = -(h as i32); // top-down
                bmi.bmiHeader.biPlanes = 1;
                bmi.bmiHeader.biBitCount = 32;
                bmi.bmiHeader.biCompression = BI_RGB;

                let mut pixels = vec![0u8; w * h * 4];
                let got = GetDIBits(
                    memdc,
                    ii.hbmColor,
                    0,
                    h as u32,
                    pixels.as_mut_ptr() as *mut _,
                    &mut bmi,
                    DIB_RGB_COLORS,
                );

                // 掩码位图(1bpp):透明像素对应位为 1。旧式无 alpha 图标靠它补 alpha。
                let stride = (w + 31) / 32 * 4;
                let mut mask = vec![0u8; stride * h];
                let mut mask_bmi = bmi.clone();
                mask_bmi.bmiHeader.biBitCount = 1;
                mask_bmi.bmiHeader.biHeight = -(h as i32);
                let got_mask = GetDIBits(
                    memdc,
                    ii.hbmMask,
                    0,
                    h as u32,
                    mask.as_mut_ptr() as *mut _,
                    &mut mask_bmi,
                    DIB_RGB_COLORS,
                );

                DeleteDC(memdc);
                ReleaseDC(std::ptr::null_mut(), hdc);
                DeleteObject(ii.hbmColor);
                DeleteObject(ii.hbmMask);
                if got == 0 {
                    return None;
                }

                let mut all_alpha_zero = true;
                for px in pixels.chunks_exact_mut(4) {
                    px.swap(0, 2); // BGRA → RGBA
                    if px[3] != 0 {
                        all_alpha_zero = false;
                    }
                }
                if all_alpha_zero && got_mask != 0 {
                    for y in 0..h {
                        for x in 0..w {
                            let bit = (mask[y * stride + x / 8] >> (7 - (x % 8))) & 1;
                            if bit == 0 {
                                pixels[(y * w + x) * 4 + 3] = 255;
                            }
                        }
                    }
                }

                let img = image::RgbaImage::from_raw(w as u32, h as u32, pixels)?;
                let mut png = Vec::new();
                image::DynamicImage::ImageRgba8(img)
                    .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
                    .ok()?;
                Some(png)
            })();
            DestroyIcon(sfi.hIcon);
            out
        }
    }

    const B64_ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    pub fn base64_encode(data: &[u8]) -> String {
        let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
        for chunk in data.chunks(3) {
            let b0 = chunk[0] as u32;
            let b1 = *chunk.get(1).unwrap_or(&0) as u32;
            let b2 = *chunk.get(2).unwrap_or(&0) as u32;
            let n = (b0 << 16) | (b1 << 8) | b2;
            out.push(B64_ALPHABET[(n >> 18) as usize & 63] as char);
            out.push(B64_ALPHABET[(n >> 12) as usize & 63] as char);
            out.push(if chunk.len() > 1 {
                B64_ALPHABET[(n >> 6) as usize & 63] as char
            } else {
                '='
            });
            out.push(if chunk.len() > 2 {
                B64_ALPHABET[n as usize & 63] as char
            } else {
                '='
            });
        }
        out
    }
}

/// macOS 实现:扫描常见应用目录下的 `.app` bundle。
///
/// macOS 没有注册表:`Info.plist` 的 `CFBundleDocumentTypes` 就是应用声明
/// “我能打开哪些类型”的地方,Launch Services 选定的默认处理程序则写在用户
/// 偏好 plist 里。两者都用系统自带的 `/usr/bin/plutil -convert json` 转成
/// JSON 后交给 serde_json 解析——`plutil` 是 macOS 基础组件,能同时处理 XML
/// 与二进制 plist,而引入 `plist` crate 会多出一棵依赖树,故不采用。
#[cfg(target_os = "macos")]
mod imp {
    use super::EditorApp;
    use rust_i18n::t;
    use serde_json::Value;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    /// 支持“用其他程序打开”的扩展名(与前端 MARKDOWN_EXTENSIONS 一致)。
    const MD_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd"];

    /// Markdown 的 UTI:前者是 macOS 标准标识,后两个是部分应用使用的别名。
    const MD_UTIS: &[&str] = &["net.daringfireball.markdown", "public.markdown", "text/markdown"];

    /// bundle 搜索目录与递归深度(深度 2 覆盖 `Utilities/`、JetBrains Toolbox
    /// 这类一级子目录)。`~/Applications` 由 HOME 拼接后单独扫描。
    const BUNDLE_DIRS: &[(&str, usize)] = &[
        ("/Applications", 2),
        ("/System/Applications", 2),
        ("/System/Library/CoreServices", 1),
    ];

    /// 扫描出的 bundle 数量上限,避免异常目录结构带来无谓开销。
    const MAX_BUNDLES: usize = 2000;

    /// 应用名(去掉 `.app` 的目录名或 CFBundleDisplayName)白名单:名称按非
    /// 字母数字切分后,任一段与此精确相等即命中。沿用 Windows 版
    /// EDITOR_EXE_TOKENS 的思路,并补充 macOS 常见编辑器;短词只做精确 token
    /// 匹配,避免 “Xcode” 之类被 “code” 之外的词误伤、反之亦然。
    const EDITOR_APP_TOKENS: &[&str] = &[
        "code", "vscode", "vscodium", "cursor", "zed", "vim", "gvim", "nvim", "neovim",
        "macvim", "idea", "studio", "devenv", "fleet", "rider", "typora", "notepad",
        "emacs", "marktext", "obsidian", "logseq", "joplin", "zettlr", "xcode",
        "textedit", "textmate", "coteditor", "nova", "bbedit", "markdown", "macdown",
        "marked", "ghostwriter", "apostrophe", "ulysses", "byword", "mou", "haroopad",
        "lightpaper", "qoder", "trae", "windsurf", "ultraedit", "atom", "brackets",
        "helix", "kakoune", "mweb", "sublime",
    ];

    /// 名称里包含这些无歧义长串即视为编辑器(对应 Windows 版的 CONTAINS)。
    const EDITOR_APP_CONTAINS: &[&str] = &[
        "visual studio code",
        "vs code",
        "intellij",
        "pycharm",
        "webstorm",
        "phpstorm",
        "rubymine",
        "datagrip",
        "rustrover",
        "goland",
        "clion",
        "codebuddy",
        "hbuilder",
        "android studio",
        "ia writer",
        "sublime text",
        "mark text",
        "one markdown",
        "notepad++",
        "deveco",
    ];

    /// 名称里包含这些片段的一律排除:卸载器/更新器/辅助进程/URL handler
    /// (如 “Claude Code URL Handler” 会被 “code” 命中)等噪音。
    const EDITOR_APP_DENY: &[&str] = &[
        "uninstall",
        "installer",
        "updater",
        "helper",
        "handler",
        "crashpad",
        "daemon",
        "reporter",
        "diagnostic",
        "agent",
        "service",
    ];

    /// `.app` 的目录名:与 Finder 显示的名称一致,也是 Info.plist 缺失时的兜底。
    pub(super) fn bundle_display_name(bundle: &Path) -> String {
        bundle
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| t!("editors.fallback_name").into_owned())
    }

    /// 名称是否落在编辑器白名单里(先过黑名单)。
    pub(super) fn is_editor_app_name(name: &str) -> bool {
        let lower = name.trim().to_lowercase();
        if lower.is_empty() || EDITOR_APP_DENY.iter().any(|d| lower.contains(d)) {
            return false;
        }
        lower
            .split(|c: char| !c.is_alphanumeric())
            .filter(|t| !t.is_empty())
            .any(|t| EDITOR_APP_TOKENS.contains(&t))
            || EDITOR_APP_CONTAINS.iter().any(|kw| lower.contains(kw))
    }

    /// VS Code 家族名称归一,与 Windows 版保持一致,避免同一应用出现两条。
    pub(super) fn canonical_editor_name(name: &str) -> String {
        let lower = name.to_lowercase();
        if lower.contains("visual studio code")
            || lower.contains("vs code")
            || lower.contains("vscode")
        {
            "Visual Studio Code".to_string()
        } else {
            name.to_string()
        }
    }

    // ---- Info.plist / Launch Services 解析 ----

    /// `CFBundleDocumentTypes` 里的一条文档类型声明。
    #[derive(Debug, Default, Clone, PartialEq, Eq)]
    pub(super) struct DocTypeDecl {
        pub name: Option<String>,
        pub extensions: Vec<String>,
        pub content_types: Vec<String>,
    }

    fn str_field(v: &Value, key: &str) -> Option<String> {
        let s = v.get(key)?.as_str()?.trim();
        (!s.is_empty()).then(|| s.to_string())
    }

    /// 取字符串数组,统一小写去空(扩展名/UTI 比较都不区分大小写)。
    fn str_array(v: &Value, key: &str) -> Vec<String> {
        v.get(key)
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str())
                    .map(|s| s.trim().to_lowercase())
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// 解析 `CFBundleDocumentTypes`;字段缺失或类型不符按空处理。
    pub(super) fn parse_document_types(plist: &Value) -> Vec<DocTypeDecl> {
        let Some(items) = plist.get("CFBundleDocumentTypes").and_then(|v| v.as_array()) else {
            return Vec::new();
        };
        items
            .iter()
            .map(|item| DocTypeDecl {
                name: str_field(item, "CFBundleTypeName"),
                extensions: str_array(item, "CFBundleTypeExtensions"),
                content_types: str_array(item, "LSItemContentTypes"),
            })
            .collect()
    }

    /// Markdown UTI 判定:命中已知 UTI,或 UTI 里带 markdown 字样。
    pub(super) fn is_markdown_content_type(ct: &str) -> bool {
        let ct = ct.trim().to_lowercase();
        MD_UTIS.iter().any(|m| ct == *m) || ct.contains("markdown")
    }

    /// 该声明是否覆盖 Markdown:扩展名命中 .md 等,或 UTI 命中 Markdown,
    /// 或声明名(CFBundleTypeName)明确写了 markdown。
    pub(super) fn declares_markdown(decl: &DocTypeDecl) -> bool {
        decl.extensions
            .iter()
            .any(|e| MD_EXTENSIONS.iter().any(|m| e.eq_ignore_ascii_case(m)))
            || decl.content_types.iter().any(|c| is_markdown_content_type(c))
            || decl
                .name
                .as_deref()
                .map(|n| n.to_lowercase().contains("markdown"))
                .unwrap_or(false)
    }

    /// 整份 Info.plist 是否声明了 Markdown 处理能力。
    pub(super) fn plist_declares_markdown(plist: &Value) -> bool {
        parse_document_types(plist).iter().any(declares_markdown)
    }

    /// 读 plist 并转成 JSON。用系统自带 `/usr/bin/plutil`,兼容 XML 与二进制
    /// plist;失败(文件不存在、格式异常、plutil 不可用)返回 None。
    pub(super) fn read_plist_json(path: &Path) -> Option<Value> {
        let out = Command::new("/usr/bin/plutil")
            .args(["-convert", "json", "-o", "-"])
            .arg(path)
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        serde_json::from_slice(&out.stdout).ok()
    }

    /// 用户级 Launch Services 偏好里的 Markdown 默认处理程序 bundle id。
    /// 文件不存在/无法解析时返回空列表(不阻塞检测)。
    pub(super) fn launch_services_markdown_handlers() -> Vec<String> {
        let Some(home) = std::env::var_os("HOME") else {
            return Vec::new();
        };
        let plist = PathBuf::from(home).join(
            "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist",
        );
        let Some(v) = read_plist_json(&plist) else {
            return Vec::new();
        };
        let Some(handlers) = v.get("LSHandlers").and_then(|h| h.as_array()) else {
            return Vec::new();
        };
        let mut ids: Vec<String> = Vec::new();
        for h in handlers {
            let ct = h
                .get("LSHandlerContentType")
                .and_then(|x| x.as_str())
                .unwrap_or_default();
            let tag = h
                .get("LSHandlerContentTag")
                .and_then(|x| x.as_str())
                .unwrap_or_default();
            let is_md = (!ct.is_empty() && is_markdown_content_type(ct))
                || (!tag.is_empty() && MD_EXTENSIONS.iter().any(|e| tag.eq_ignore_ascii_case(e)));
            if !is_md {
                continue;
            }
            if let Some(role) = h.get("LSHandlerRoleAll").and_then(|x| x.as_str()) {
                let role = role.trim();
                if !role.is_empty() && role != "-" {
                    ids.push(role.to_string());
                }
            }
        }
        ids.sort();
        ids.dedup();
        ids
    }

    /// bundle id → `.app` 路径(Spotlight)。Spotlight 不可用时返回 None,
    /// 检测结果只是少一条,不影响其余条目。
    pub(super) fn bundle_path_for_id(id: &str) -> Option<PathBuf> {
        // bundle id 来自 plist,仍做一次保守校验,避免拼出畸形查询串。
        if id.is_empty() || id.contains(['\'', '"']) {
            return None;
        }
        let out = Command::new("/usr/bin/mdfind")
            .arg(format!("kMDItemCFBundleIdentifier == '{id}'"))
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(PathBuf::from)
            .find(|p| p.is_dir() && has_app_extension(p))
    }

    // ---- 候选收集 ----

    /// 一个候选应用:bundle 目录、对外暴露的启动目标、显示名、推荐标记。
    #[derive(Clone)]
    pub(super) struct Candidate {
        pub bundle: PathBuf,
        pub exe: PathBuf,
        pub name: String,
        pub recommended: bool,
    }

    fn has_app_extension(p: &Path) -> bool {
        p.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("app"))
            .unwrap_or(false)
    }

    /// bundle 内可执行文件:`Contents/MacOS/<CFBundleExecutable>`;plist 缺失或
    /// 指向不存在的文件时,退回该目录下唯一的普通文件;都取不到时退回 `.app`
    /// 本身(`open -a` 仍可启动)。
    pub(super) fn bundle_executable(bundle: &Path, plist: Option<&Value>) -> PathBuf {
        let macos = bundle.join("Contents").join("MacOS");
        if let Some(exe) = plist.and_then(|p| str_field(p, "CFBundleExecutable")) {
            let p = macos.join(exe);
            if p.is_file() {
                return p;
            }
        }
        if let Ok(rd) = std::fs::read_dir(&macos) {
            let mut files: Vec<PathBuf> = rd
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_file())
                .collect();
            if files.len() == 1 {
                return files.remove(0);
            }
        }
        bundle.to_path_buf()
    }

    /// 组装一个候选。显示名优先 CFBundleDisplayName / CFBundleName,其次目录名;
    /// `recommended` 由 Info.plist 的 Markdown 声明或 Launch Services 默认处理
    /// 程序决定。
    fn push_candidate(
        bundle: &Path,
        plist: Option<&Value>,
        default_ids: &[String],
        out: &mut Vec<Candidate>,
    ) {
        let id = plist
            .and_then(|p| p.get("CFBundleIdentifier"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or_default();
        let name = plist
            .and_then(|p| {
                str_field(p, "CFBundleDisplayName").or_else(|| str_field(p, "CFBundleName"))
            })
            .unwrap_or_else(|| bundle_display_name(bundle));
        let recommended = plist.map(plist_declares_markdown).unwrap_or(false)
            || (!id.is_empty() && default_ids.iter().any(|d| d == id));
        out.push(Candidate {
            bundle: bundle.to_path_buf(),
            exe: bundle_executable(bundle, plist),
            name,
            recommended,
        });
    }

    /// 递归收集 `.app`(不进入 bundle 内部),深度用尽即停。
    fn collect_bundles(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        if depth == 0 || out.len() >= MAX_BUNDLES {
            return;
        }
        let Ok(rd) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in rd.flatten() {
            if out.len() >= MAX_BUNDLES {
                return;
            }
            let p = entry.path();
            if has_app_extension(&p) {
                out.push(p);
            } else if depth > 1 && p.is_dir() {
                collect_bundles(&p, depth - 1, out);
            }
        }
    }

    /// 自身 bundle(从当前可执行文件向上找最近的 `.app`)。
    fn own_bundle() -> Option<PathBuf> {
        app_bundle_of(&std::env::current_exe().ok()?)
    }

    fn is_openmd_name(name: &str) -> bool {
        name.trim().to_lowercase() == "openmd"
    }

    fn is_known_bundle(bundle: &Path, cands: &[Candidate]) -> bool {
        let Ok(can) = std::fs::canonicalize(bundle) else {
            return false;
        };
        cands
            .iter()
            .any(|c| std::fs::canonicalize(&c.bundle).map(|b| b == can).unwrap_or(false))
    }

    /// 规范化、去重(按 bundle 路径与归一化显示名)、排除 OpenMD 自身,
    /// 推荐在前、名称排序。图标在 macOS 上不提取(前端回退通用图标)。
    pub(super) fn finalize(cands: Vec<Candidate>, own_bundle: Option<&Path>) -> Vec<EditorApp> {
        let own = own_bundle.and_then(|p| std::fs::canonicalize(p).ok());
        let mut out: Vec<EditorApp> = Vec::new();
        let mut seen_bundles: Vec<PathBuf> = Vec::new();
        for c in cands {
            let Ok(can) = std::fs::canonicalize(&c.bundle) else {
                continue;
            };
            if !can.is_dir() || seen_bundles.contains(&can) {
                continue;
            }
            if let Some(own) = &own {
                if can == *own {
                    continue;
                }
            }
            let name = canonical_editor_name(&c.name);
            if is_openmd_name(&name) {
                continue;
            }
            // 同名(归一化后)视为同一应用:已存在时,仅在新区表被系统推荐时
            // 升级为推荐(exe 也随之更新)。
            if let Some(pos) = out.iter().position(|e| e.name.eq_ignore_ascii_case(&name)) {
                if c.recommended && !out[pos].recommended {
                    out[pos].exe = c.exe.to_string_lossy().into_owned();
                    out[pos].recommended = true;
                }
                continue;
            }
            seen_bundles.push(can);
            out.push(EditorApp {
                name,
                exe: c.exe.to_string_lossy().into_owned(),
                icon: None,
                recommended: c.recommended,
            });
        }
        out.sort_by(|a, b| {
            b.recommended
                .cmp(&a.recommended)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        out
    }

    /// 检测入口:`Info.plist` 声明 + Launch Services 默认处理程序并集。
    pub(super) fn detect_editors_impl() -> Vec<EditorApp> {
        let default_ids = launch_services_markdown_handlers();

        let mut bundles: Vec<PathBuf> = Vec::new();
        for (dir, depth) in BUNDLE_DIRS {
            collect_bundles(Path::new(dir), *depth, &mut bundles);
        }
        if let Some(home) = std::env::var_os("HOME") {
            collect_bundles(&PathBuf::from(home).join("Applications"), 2, &mut bundles);
        }

        let mut cands: Vec<Candidate> = Vec::new();
        for bundle in &bundles {
            // 白名单只作用于扫描来源:全量读取每个 bundle 的 Info.plist 既慢,
            // 也会把声明了 markdown UTI 却并非编辑器的应用(如各种 Electron
            // 应用的样板声明)带进来。
            if !is_editor_app_name(&bundle_display_name(bundle)) {
                continue;
            }
            let plist = read_plist_json(&bundle.join("Contents").join("Info.plist"));
            push_candidate(bundle, plist.as_ref(), &default_ids, &mut cands);
        }

        // Launch Services 的默认 Markdown 处理程序:即使名字不在白名单里,
        // 它也是系统认可的打开方式,应当出现在菜单里。
        for id in &default_ids {
            let Some(bundle) = bundle_path_for_id(id) else {
                continue;
            };
            if is_known_bundle(&bundle, &cands) {
                continue;
            }
            let plist = read_plist_json(&bundle.join("Contents").join("Info.plist"));
            push_candidate(&bundle, plist.as_ref(), &default_ids, &mut cands);
        }

        finalize(cands, own_bundle().as_deref())
    }

    // ---- 启动 ----

    /// 从任意路径向上找最近的 `.app` 组件(不做存在性判断)。
    pub(super) fn app_bundle_of(p: &Path) -> Option<PathBuf> {
        if has_app_extension(p) {
            return Some(p.to_path_buf());
        }
        let mut cur = p.parent();
        while let Some(c) = cur {
            if has_app_extension(c) {
                return Some(c.to_path_buf());
            }
            cur = c.parent();
        }
        None
    }

    /// exe 是否恰好是 bundle 内 `Contents/MacOS/` 下的普通文件(解析符号链接
    /// 后比较,防止 `Foo.app/../../etc/passwd` 之类的伪造路径)。
    pub(super) fn is_bundle_macos_executable(exe: &Path, bundle: &Path) -> bool {
        if !exe.is_file() {
            return false;
        }
        let (Ok(exe), Ok(bundle)) = (std::fs::canonicalize(exe), std::fs::canonicalize(bundle))
        else {
            return false;
        };
        exe.parent() == Some(bundle.join("Contents").join("MacOS").as_path())
    }

    /// 校验前端传来的 exe 是不是合法的 macOS 启动目标,返回要交给 `open -a`
    /// 的 bundle 路径。除 `.app` 本身外,只接受 bundle 内 `Contents/MacOS/` 下
    /// 的可执行文件;任意其它二进制一律拒绝。
    pub(super) fn resolve_launch_bundle(exe: &str) -> Result<PathBuf, String> {
        let exe_path = Path::new(exe);
        let bundle = app_bundle_of(exe_path)
            .ok_or_else(|| t!("editors.not_macos_app", exe = exe).into_owned())?;
        if !bundle.is_dir() {
            return Err(t!("editors.exe_not_found", exe = exe).into_owned());
        }
        if exe_path != bundle && !is_bundle_macos_executable(exe_path, &bundle) {
            return Err(t!("editors.not_executable", exe = exe).into_owned());
        }
        Ok(bundle)
    }

    /// 用 `/usr/bin/open -a <app> <file>` 打开,避免直接执行任意二进制;
    /// `open` 的 stderr 原样带回给前端。
    pub(super) fn launch_macos(exe: &str, path: &str) -> Result<(), String> {
        let bundle = resolve_launch_bundle(exe)?;
        let out = Command::new("/usr/bin/open")
            .arg("-a")
            .arg(&bundle)
            .arg(path)
            .output()
            .map_err(|e| t!("editors.launch_failed", exe = exe, error = e).into_owned())?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(if err.is_empty() {
                t!("editors.launch_failed_no_reason", exe = exe).into_owned()
            } else {
                t!("editors.launch_failed", exe = exe, error = err).into_owned()
            });
        }
        Ok(())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::imp::{
        base64_encode, canonical_editor_name, clean_display_name, expand_env,
        is_editor_display_name, is_editor_exe, merge, parse_exe_from_command, stem_name,
    };
    use super::imp::Candidate;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn scratch(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "openmd-editors-{}-{}-{}",
            prefix,
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch(path: &Path) -> PathBuf {
        fs::write(path, b"MZ").unwrap();
        path.to_path_buf()
    }

    #[test]
    fn quoted_command_extracts_exe() {
        let got = parse_exe_from_command(r#""C:\Program Files\Microsoft VS Code\Code.exe" "%1""#);
        assert_eq!(
            got,
            Some(PathBuf::from(r"C:\Program Files\Microsoft VS Code\Code.exe"))
        );
    }

    #[test]
    fn unquoted_command_stops_after_exe() {
        let got = parse_exe_from_command(r"C:\Tools\app.exe --open %1");
        assert_eq!(got, Some(PathBuf::from(r"C:\Tools\app.exe")));
    }

    #[test]
    fn env_var_prefix_is_expanded() {
        std::env::var("SystemRoot").expect("SystemRoot must exist on Windows");
        let got = parse_exe_from_command(r"%SystemRoot%\system32\NOTEPAD.EXE %1");
        assert!(got
            .map(|p| p.to_string_lossy().to_lowercase().ends_with(r"\system32\notepad.exe"))
            .unwrap_or(false));
    }

    #[test]
    fn commands_without_exe_token_are_refused() {
        assert_eq!(parse_exe_from_command("rundll32 shell32.dll,OpenAs_RunDLL %1"), None);
        assert_eq!(parse_exe_from_command(""), None);
        assert_eq!(parse_exe_from_command(r#""C:\x\app.exe""#).is_some(), true);
    }

    #[test]
    fn expand_env_keeps_unknown_vars_literal() {
        assert_eq!(expand_env(r"%OPENMD_NOPE_XYZ%\x"), r"%OPENMD_NOPE_XYZ%\x");
        assert_eq!(expand_env("plain\\path"), r"plain\path");
    }

    #[test]
    fn stem_name_trims_trailing_64() {
        assert_eq!(stem_name(Path::new(r"C:\jb\bin\idea64.exe")), "idea");
        assert_eq!(stem_name(Path::new(r"C:\x\Code.exe")), "Code");
        assert_eq!(stem_name(Path::new(r"C:\x\64.exe")), "64");
    }

    #[test]
    fn editor_keyword_filter_matches_ides_and_rejects_players() {
        for ok in [
            "Code.exe",
            "new_Code.exe",
            "Trae.exe",
            "TraeCode CN.exe",
            "TRAE SOLO CN.exe",
            "Qoder.exe",
            "CodeBuddy CN.exe",
            "MiniMax Code.exe",
            "idea64.exe",
            "pycharm64.exe",
            "notepad++.exe",
            "sublime_text.exe",
            "studio64.exe",
            "Typora.exe",
            "gvim.exe",
            "Obsidian.exe",
        ] {
            assert!(is_editor_exe(ok), "{ok} should match");
        }
        for bad in [
            "PotPlayer.exe",
            "wmploc.dll",
            "iexplore.exe",
            "Photoshop.exe",
            "quark.exe",
            "wps.exe",
            "douyin.exe",
            "WorkBuddy.exe",
            "provtool.exe",
            "codec_checker.exe",
            "Uninstall ZCode.exe",
            "notepad_helper.dll",
        ] {
            assert!(!is_editor_exe(bad), "{bad} should not match");
        }
    }

    #[test]
    fn display_name_filter_and_suffix_cleanup() {
        assert!(is_editor_display_name("Microsoft Visual Studio Code (User)"));
        assert!(is_editor_display_name("PyCharm Community Edition"));
        assert!(!is_editor_display_name("ToDesk"));
        assert_eq!(clean_display_name("TraeCode CN (User)"), "TraeCode CN");
        assert_eq!(
            clean_display_name("Microsoft Visual Studio Code (Machine)"),
            "Microsoft Visual Studio Code"
        );
        assert_eq!(clean_display_name("Typora"), "Typora");
    }

    #[test]
    fn base64_encode_matches_rfc4648_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
    }

    #[test]
    fn detect_editors_on_this_machine_returns_sane_entries() {
        // 不变量断言(任意机器成立):路径存在、名称非空、推荐标记可靠、
        // 无未还原的间接字符串;同时人工核对 --nocapture 的输出。
        let list = super::imp::detect_editors_impl();
        for e in &list {
            assert!(Path::new(&e.exe).is_file(), "{} 不存在", e.exe);
            assert!(!e.name.is_empty());
            assert!(!e.name.starts_with('@'), "间接字符串未还原: {}", e.name);
        }
        for e in &list {
            println!(
                "{:?} | {} | recommended={}",
                e.name, e.exe, e.recommended
            );
        }
    }

    #[test]
    fn vscode_family_names_are_canonicalized() {
        assert_eq!(canonical_editor_name("Microsoft VS Code"), "Visual Studio Code");
        assert_eq!(
            canonical_editor_name("Microsoft Visual Studio Code"),
            "Visual Studio Code"
        );
        assert_eq!(canonical_editor_name("VS Code"), "Visual Studio Code");
        assert_eq!(canonical_editor_name("Trae CN"), "Trae CN");
        assert_eq!(canonical_editor_name("Qoder CN IDE"), "Qoder CN IDE");
    }

    #[test]
    fn merge_collapses_same_app_preferring_canonical_exe() {
        let dir = scratch("merge3");
        let renamed = touch(&dir.join("renamed.exe"));
        let canon = touch(&dir.join("code.exe"));

        let cands = vec![
            Candidate {
                exe: renamed.clone(),
                name: Some("Microsoft Visual Studio Code".into()),
                recommended: false,
            },
            Candidate {
                exe: canon.clone(),
                name: Some("Microsoft VS Code".into()),
                recommended: false,
            },
        ];
        let got = merge(cands, None);

        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "Visual Studio Code");
        assert_eq!(got[0].exe, canon.to_string_lossy().into_owned());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn merge_dedupes_orders_and_excludes_own() {
        let dir = scratch("merge");
        let a = touch(&dir.join("alpha.exe"));
        let b = touch(&dir.join("beta.exe"));

        let cands = vec![
            Candidate { exe: a.clone(), name: None, recommended: false },
            Candidate { exe: b.clone(), name: Some("Beta".into()), recommended: true },
            Candidate { exe: a.clone(), name: Some("Alpha".into()), recommended: true },
            Candidate { exe: dir.join("gone.exe"), name: Some("Gone".into()), recommended: true },
        ];
        let got = merge(cands, Some(&a));

        // a.exe 两次出现都被自身排除规则跳过,gone.exe 因不存在被过滤,
        // 只剩 b.exe(显示名取显式提供的 “Beta”)。
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "Beta");
        assert!(got[0].recommended);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn merge_prefers_recommended_and_sorts_by_name() {
        let dir = scratch("merge2");
        let a = touch(&dir.join("zeta.exe"));
        let b = touch(&dir.join("alpha.exe"));

        let cands = vec![
            Candidate { exe: a.clone(), name: Some("Zeta".into()), recommended: false },
            Candidate { exe: b.clone(), name: Some("Alpha".into()), recommended: true },
        ];
        let got = merge(cands, None);

        assert_eq!(got.len(), 2);
        assert!(got[0].recommended && got[0].name == "Alpha");
        assert!(!got[1].recommended && got[1].name == "Zeta");
        fs::remove_dir_all(&dir).ok();
    }
}

/// macOS 纯逻辑单测:不依赖本机装了哪些应用,只用手造 JSON 与临时目录。
#[cfg(all(test, target_os = "macos"))]
mod mac_tests {
    use super::imp::{
        app_bundle_of, bundle_executable, canonical_editor_name, declares_markdown, finalize,
        is_bundle_macos_executable, is_editor_app_name, parse_document_types,
        plist_declares_markdown, resolve_launch_bundle, Candidate,
    };
    use serde_json::json;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn scratch(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "openmd-mac-editors-{}-{}-{}",
            prefix,
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn document_types_and_markdown_detection() {
        // 形如 VS Code / Cursor:一条 markdown 声明混在大量代码类型里。
        let cursor_like = json!({
            "CFBundleDocumentTypes": [
                {"CFBundleTypeName": "C source code", "CFBundleTypeExtensions": ["c"]},
                {"CFBundleTypeName": "Markdown document",
                 "CFBundleTypeExtensions": ["markdown", "MD", "mdown", "mkd"]}
            ]
        });
        // 形如 TextEdit:只声明纯文本/任意数据,不算 Markdown 关联。
        let textedit_like = json!({
            "CFBundleDocumentTypes": [
                {"CFBundleTypeName": "NSStringPboardType",
                 "LSItemContentTypes": ["public.plain-text"]},
                {"CFBundleTypeName": "Unknown document", "LSItemContentTypes": ["public.data"]}
            ]
        });
        let uti_only = json!({
            "CFBundleDocumentTypes": [
                {"CFBundleTypeName": "Document",
                 "LSItemContentTypes": ["net.daringfireball.markdown"]}
            ]
        });
        let alias_uti = json!({
            "CFBundleDocumentTypes": [{"LSItemContentTypes": ["public.markdown"]}]
        });

        assert!(plist_declares_markdown(&cursor_like));
        assert!(plist_declares_markdown(&uti_only));
        assert!(plist_declares_markdown(&alias_uti));
        assert!(!plist_declares_markdown(&textedit_like));
        assert!(!plist_declares_markdown(&json!({})));
        assert!(!plist_declares_markdown(&json!({"CFBundleDocumentTypes": "oops"})));

        let decls = parse_document_types(&cursor_like);
        assert_eq!(decls.len(), 2);
        assert!(!declares_markdown(&decls[0]));
        assert!(declares_markdown(&decls[1]));
        assert_eq!(decls[0].extensions, vec!["c".to_string()]);
        assert_eq!(decls[0].name.as_deref(), Some("C source code"));
    }

    #[test]
    fn editor_app_allowlist_matches_editors_and_rejects_noise() {
        for ok in [
            "Visual Studio Code",
            "VS Code Insiders",
            "VSCodium",
            "Cursor",
            "Zed",
            "Sublime Text",
            "BBEdit",
            "TextMate",
            "Typora",
            "Obsidian",
            "MarkText",
            "MacDown",
            "Marked 2",
            "iA Writer",
            "TextEdit",
            "Xcode",
            "Nova",
            "CotEditor",
            "Windsurf",
            "IntelliJ IDEA",
            "PyCharm",
            "Qoder CN",
            "Zettlr",
            "Joplin",
            "MacVim",
            "Notepad++",
            "Android Studio",
        ] {
            assert!(is_editor_app_name(ok), "{ok} should match");
        }
        for bad in [
            "Google Chrome",
            "Safari",
            "Claude",
            "Claude Code URL Handler",
            "WorkBuddy",
            "CC Switch",
            "OpenDisk",
            "Script Editor",
            "Finder",
            "Uninstall Zed",
            "Zed Updater",
            "OpenMD",
            "",
        ] {
            assert!(!is_editor_app_name(bad), "{bad} should not match");
        }
    }

    #[test]
    fn vscode_family_names_are_canonicalized() {
        assert_eq!(canonical_editor_name("Microsoft VS Code"), "Visual Studio Code");
        assert_eq!(
            canonical_editor_name("Visual Studio Code"),
            "Visual Studio Code"
        );
        assert_eq!(canonical_editor_name("Cursor"), "Cursor");
    }

    #[test]
    fn finalize_orders_recommended_first_and_dedupes() {
        let dir = scratch("finalize");
        let mk = |n: &str| {
            let p = dir.join(n);
            fs::create_dir_all(&p).unwrap();
            p
        };
        let alpha = mk("Alpha.app");
        let beta = mk("Beta.app");
        let gamma = mk("Gamma.app");
        let delta = mk("Delta.app");
        let epsilon = mk("Epsilon.app");
        let openmd = mk("OpenMD.app");

        let cand = |bundle: &PathBuf, name: &str, recommended: bool| Candidate {
            bundle: bundle.clone(),
            exe: bundle.join("Contents/MacOS/x"),
            name: name.to_string(),
            recommended,
        };

        let got = finalize(
            vec![
                cand(&alpha, "Alpha", false),
                cand(&beta, "Beta", true),
                cand(&alpha, "Alpha", true), // 同一 bundle:去重,保留先出现的
                cand(&delta, "Zeta", false), // 与下一条同名:保留 recommended 的
                cand(&epsilon, "Zeta", true),
                cand(&gamma, "Gamma", false), // own_bundle:排除
                cand(&openmd, "OpenMD", true), // 自身名称:排除
                Candidate {
                    bundle: dir.join("Gone.app"),
                    exe: dir.join("gone"),
                    name: "Gone".into(),
                    recommended: true,
                },
            ],
            Some(&gamma),
        );

        let names: Vec<&str> = got.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["Beta", "Zeta", "Alpha"]);
        assert!(got[0].recommended);
        assert!(got[1].recommended);
        assert!(!got[2].recommended);
        assert!(got[1].exe.ends_with("Epsilon.app/Contents/MacOS/x"));
        assert!(got.iter().all(|e| e.icon.is_none()));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn bundle_executable_prefers_plist_name_then_sole_file() {
        let dir = scratch("exe");
        let bundle = dir.join("Bar.app");
        let macos = bundle.join("Contents/MacOS");
        fs::create_dir_all(&macos).unwrap();
        fs::write(macos.join("Bar"), b"x").unwrap();
        fs::write(macos.join("Bar Helper"), b"x").unwrap();

        let ok = json!({"CFBundleExecutable": "Bar"});
        assert_eq!(bundle_executable(&bundle, Some(&ok)), macos.join("Bar"));
        // plist 指向不存在的文件、且目录下不止一个文件 → 退回 .app 本身
        let missing = json!({"CFBundleExecutable": "Nope"});
        assert_eq!(bundle_executable(&bundle, Some(&missing)), bundle);
        // 目录下只有一个普通文件时可推断
        fs::remove_file(macos.join("Bar Helper")).unwrap();
        assert_eq!(bundle_executable(&bundle, None), macos.join("Bar"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn launch_target_must_be_app_bundle_or_its_macos_executable() {
        let dir = scratch("launch");
        let bundle = dir.join("Foo.app");
        let macos = bundle.join("Contents/MacOS");
        fs::create_dir_all(&macos).unwrap();
        let good = macos.join("Foo");
        fs::write(&good, b"#!/bin/sh\n").unwrap();

        let canon = |p: &Path| fs::canonicalize(p).unwrap();
        assert_eq!(
            canon(&resolve_launch_bundle(bundle.to_str().unwrap()).unwrap()),
            canon(&bundle)
        );
        assert_eq!(
            canon(&resolve_launch_bundle(good.to_str().unwrap()).unwrap()),
            canon(&bundle)
        );

        // 拒绝:任意二进制、不存在的 .app、bundle 内缺失的 exe、bundle 内非
        // Contents/MacOS 的文件
        assert!(resolve_launch_bundle("/bin/sh").is_err());
        assert!(resolve_launch_bundle(dir.join("Bar.app").to_str().unwrap()).is_err());
        assert!(resolve_launch_bundle(macos.join("Missing").to_str().unwrap()).is_err());
        let res = bundle.join("Contents/Resources/evil");
        fs::create_dir_all(res.parent().unwrap()).unwrap();
        fs::write(&res, b"x").unwrap();
        assert!(resolve_launch_bundle(res.to_str().unwrap()).is_err());

        assert!(app_bundle_of(&good).unwrap().ends_with("Foo.app"));
        assert!(is_bundle_macos_executable(&good, &bundle));
        assert!(!is_bundle_macos_executable(&res, &bundle));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn detect_editors_on_this_machine_returns_sane_entries() {
        // 只断言任意 Mac 都成立的不变量(启动目标存在、名称非空、无重名),
        // 具体装了哪些应用不影响判定;本机菜单内容用 --nocapture 人工核对。
        let list = super::imp::detect_editors_impl();
        for e in &list {
            let p = Path::new(&e.exe);
            assert!(
                p.is_file() || (p.is_dir() && e.exe.ends_with(".app")),
                "{} 不是可启动目标",
                e.exe
            );
            assert!(!e.name.is_empty());
        }
        for (i, a) in list.iter().enumerate() {
            for b in &list[i + 1..] {
                assert!(
                    !a.name.eq_ignore_ascii_case(&b.name),
                    "菜单里出现重名应用: {}",
                    a.name
                );
            }
        }
        for e in &list {
            println!("{:?} | {} | recommended={}", e.name, e.exe, e.recommended);
        }
    }
}
