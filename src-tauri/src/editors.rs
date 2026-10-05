//! “用其他程序打开”菜单的数据源:扫描系统里能打开 Markdown 的程序。
//!
//! 两个来源取并集:
//! 1. `.md`(及 markdown/mdown/mkd)的关联信息:HKCR 与 HKCU FileExts 下的
//!    默认 ProgID / OpenWithList / OpenWithProgids / UserChoice——即系统
//!    “打开方式”的推荐栏加上用户历史上用过的程序。标记为 `recommended`,
//!    菜单里排在前面。
//! 2. `HKCR\Applications` 里能对上已知编辑器/IDE 关键字的条目——让装了但没
//!    关联 .md 的 IDE 也能出现。全量枚举会把播放器、网盘之类无关应用带进来,
//!    所以这里按 exe 文件名关键字过滤(见 [`imp::EDITOR_EXE_KEYWORDS`])。
//!
//! 每个条目解析出真实 exe 路径与友好名称(FriendlyAppName / FriendlyTypeName,
//! “@file,-idx” 间接字符串经 SHLoadIndirectString 还原),同时提取 exe 图标转成
//! PNG data URL(进程内缓存),排除 OpenMD 自身后按“推荐在前、名称排序”返回。

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
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// 用选中的程序打开文件。绑定 exe 必须存在且是可执行文件,防止前端被诱导
/// 拼出任意命令;文件必须存在。
#[tauri::command]
pub fn open_file_with(exe: String, path: String) -> Result<(), String> {
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
