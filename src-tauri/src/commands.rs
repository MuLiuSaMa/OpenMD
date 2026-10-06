use std::fs;
use std::path::{Path, PathBuf};

use rust_i18n::t;
use tauri::{AppHandle, Manager};

/// 前端诊断日志入口(追加到 app_data_dir/assoc-debug.log,排查文件关联转发链路)
#[tauri::command]
pub fn log_assoc(message: String, app: AppHandle) {
    crate::debug_log(&app, &message);
}

/// Extensions the app is allowed to read on behalf of the web view. OpenMD is
/// a markdown viewer: a document and its links are text. Bounding the
/// filesystem command to this set means that even if a script ever ran in the
/// web view, it cannot turn `read_markdown_file` into an arbitrary-file read
/// primitive against `~/.ssh/id_rsa`, `authorized_keys` and the like.
const ALLOWED_TEXT_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mdx", "txt", "text"];

pub(crate) fn has_allowed_extension(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| ALLOWED_TEXT_EXTENSIONS.iter().any(|a| a.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

#[tauri::command]
pub fn read_markdown_file(path: String) -> Result<String, String> {
    let p = Path::new(&path);

    if !has_allowed_extension(p) {
        return Err(t!("read.refuse_non_text", path = path).into_owned());
    }

    if !p.exists() {
        return Err(t!("read.not_found", path = path).into_owned());
    }

    if !p.is_file() {
        return Err(t!("read.not_a_file", path = path).into_owned());
    }

    fs::read_to_string(p).map_err(|e| {
        // `read_to_string` rejects anything that is not valid UTF-8, which is
        // what a UTF-16 save looks like — Notepad offers it in the same Save As
        // dropdown that produces a BOM. The raw io error ("stream did not
        // contain valid UTF-8") tells a user nothing they can act on.
        if e.kind() == std::io::ErrorKind::InvalidData {
            t!("read.not_utf8", path = path).into_owned()
        } else {
            t!("read.failed", error = e).into_owned()
        }
    })
}

/// Write markdown content back to a file — the edit mode's save path.
///
/// Bounded by the same extension allowlist as [`read_markdown_file`]: the web
/// view can only ever overwrite the text documents it is allowed to open,
/// never an arbitrary path like a script or the SSH config.
#[tauri::command]
pub fn write_markdown_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);

    if !has_allowed_extension(p) {
        return Err(t!("write.refuse_non_text", path = path).into_owned());
    }

    if p.exists() && !p.is_file() {
        return Err(t!("read.not_a_file", path = path).into_owned());
    }

    fs::write(p, content).map_err(|e| t!("write.failed", error = e).into_owned())
}

/// The current user's home directory.
///
/// `std::env::var("HOME")` is not set on Windows, so `USERPROFILE` (plus the
/// HOMEDRIVE/HOMEPATH fallback for older/roaming setups) is what Windows
/// actually provides.
pub fn home_dir() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    {
        if let Some(profile) = std::env::var_os("USERPROFILE").filter(|s| !s.is_empty()) {
            return Some(std::path::PathBuf::from(profile));
        }
        match (
            std::env::var_os("HOMEDRIVE").filter(|s| !s.is_empty()),
            std::env::var_os("HOMEPATH").filter(|s| !s.is_empty()),
        ) {
            (Some(drive), Some(rest)) => {
                let mut joined = std::ffi::OsString::from(drive);
                joined.push(&rest);
                Some(std::path::PathBuf::from(joined))
            }
            _ => None,
        }
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME")
            .filter(|s| !s.is_empty())
            .map(std::path::PathBuf::from)
    }
}

/// Strip Windows' verbatim prefix (`\\?\`) that `canonicalize` returns.
///
/// The prefix is valid but leaks into anything that displays the path, and it
/// breaks naive string handling on the frontend. `\\?\UNC\server\share` folds
/// back to `\\server\share`. No-op on other platforms.
fn strip_verbatim_prefix(path: String) -> String {
    #[cfg(windows)]
    {
        if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{}", rest);
        }
        if let Some(rest) = path.strip_prefix(r"\\?\") {
            return rest.to_string();
        }
    }
    path
}

#[tauri::command]
pub fn resolve_path(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let absolute = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| t!("path.cwd_failed", error = e).into_owned())?
            .join(p)
    };

    absolute
        .canonicalize()
        .unwrap_or(absolute)
        .to_str()
        .map(|s| strip_verbatim_prefix(s.to_string()))
        .ok_or_else(|| t!("path.invalid_utf8", path = path).into_owned())
}

/// Whether a path exists on disk. Used by the local-file-link handler to
/// surface a graceful "file not found" toast before attempting to open,
/// instead of silently no-opping or replacing the current document.
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Whether a path is an existing directory (drag-drop decides folder vs file).
#[tauri::command]
pub fn is_directory(path: String) -> bool {
    Path::new(&path).is_dir()
}

// ---- 工作区目录树 ----

/// Directory names the workspace tree never shows: dotfile/hidden entries and
/// dependency/VCS farms that would bury the actual notes.
fn is_ignored_workspace_dir(name: &str) -> bool {
    name.starts_with('.') || name.eq_ignore_ascii_case("node_modules")
}

/// One row of the workspace tree: a subdirectory or a readable text document.
#[derive(serde::Serialize)]
pub struct WorkspaceEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// "a2" sorts before "a10": digit runs compare numerically, everything else
/// case-insensitively. Ties fall back to plain byte order.
pub(crate) fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let mut ac = a.chars().peekable();
    let mut bc = b.chars().peekable();
    loop {
        let (x, y) = match (ac.peek().copied(), bc.peek().copied()) {
            (None, None) => return a.cmp(b),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) => (x, y),
        };
        if x.is_ascii_digit() && y.is_ascii_digit() {
            let take = |it: &mut std::iter::Peekable<std::str::Chars>, first: char| {
                let mut digits = String::new();
                let mut peeked = Some(first);
                while let Some(c) = peeked {
                    if !c.is_ascii_digit() {
                        break;
                    }
                    digits.push(c);
                    it.next();
                    peeked = it.peek().copied();
                }
                digits
            };
            let av = take(&mut ac, x).parse::<u128>().unwrap_or(u128::MAX);
            let bv = take(&mut bc, y).parse::<u128>().unwrap_or(u128::MAX);
            if av != bv {
                return av.cmp(&bv);
            }
        } else {
            let ord = x.to_lowercase().cmp(y.to_lowercase());
            if ord != Ordering::Equal {
                return ord;
            }
            ac.next();
            bc.next();
        }
    }
}

/// Non-recursive listing of one workspace directory for the sidebar tree:
/// subdirectories (minus ignored ones) plus reader-allowlist files, directories
/// first and each group naturally sorted. The frontend expands lazily, one
/// level per call, so huge trees only cost what the user actually opens.
#[tauri::command]
pub fn list_workspace_dir(path: String) -> Result<Vec<WorkspaceEntry>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(t!("workspace.not_a_dir", path = path).into_owned());
    }
    let entries = fs::read_dir(dir).map_err(|e| t!("read.failed", error = e).into_owned())?;
    let mut dirs: Vec<WorkspaceEntry> = Vec::new();
    let mut files: Vec<WorkspaceEntry> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let p = entry.path();
        match entry.file_type() {
            Ok(ft) if ft.is_dir() => {
                if is_ignored_workspace_dir(&name) {
                    continue;
                }
                dirs.push(WorkspaceEntry {
                    name,
                    path: p.to_string_lossy().into_owned(),
                    is_dir: true,
                });
            }
            Ok(ft) if ft.is_file() && has_allowed_extension(&p) => {
                files.push(WorkspaceEntry {
                    name,
                    path: p.to_string_lossy().into_owned(),
                    is_dir: false,
                });
            }
            _ => {}
        }
    }
    let sort = |list: &mut Vec<WorkspaceEntry>| {
        list.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    };
    sort(&mut dirs);
    sort(&mut files);
    dirs.extend(files);
    Ok(dirs)
}

/// Recursion bound for [`scan_markdown_files`]. A workspace is a folder of
/// notes, not a disk image: past this the walk stops descending instead of
/// turning one click into an unbounded filesystem traversal.
const WORKSPACE_SCAN_MAX_DEPTH: usize = 12;

/// Hard ceiling on collected paths, so a pathological tree (say a checkout of
/// generated docs) cannot blow up the IPC payload either.
const WORKSPACE_SCAN_MAX_FILES: usize = 5000;

/// How many paths [`list_workspace_files`] returns alongside the count. The
/// home screen only needs the total; the sample keeps the door open for a flat
/// listing later without shipping every path of a huge workspace.
const WORKSPACE_SCAN_FILES_PREVIEW: usize = 50;

/// Recursive listing of the text documents under `root`, shared by
/// [`list_workspace_files`] and its tests.
///
/// Directories are walked depth-first in the same natural order the sidebar
/// tree uses, hidden and `node_modules` directories are skipped exactly like
/// [`list_workspace_dir`], and only [`ALLOWED_TEXT_EXTENSIONS`] files are
/// collected. `remaining` is the file-count budget: the walk stops as soon as
/// it is exhausted, so both depth and total work are bounded. Unreadable
/// subdirectories are skipped rather than failing the whole scan.
fn scan_markdown_files(root: &Path, remaining: &mut usize) -> Vec<String> {
    let mut out = Vec::new();
    walk_markdown_files(root, remaining, 0, &mut out);
    out
}

fn walk_markdown_files(dir: &Path, remaining: &mut usize, depth: usize, out: &mut Vec<String>) {
    if depth >= WORKSPACE_SCAN_MAX_DEPTH || *remaining == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut files: Vec<(String, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        match entry.file_type() {
            Ok(ft) if ft.is_dir() => {
                if !is_ignored_workspace_dir(&name) {
                    dirs.push(path);
                }
            }
            Ok(ft) if ft.is_file() && has_allowed_extension(&path) => files.push((name, path)),
            _ => {}
        }
    }
    dirs.sort_by(|a, b| {
        natural_cmp(
            &a.file_name().unwrap_or_default().to_string_lossy(),
            &b.file_name().unwrap_or_default().to_string_lossy(),
        )
    });
    files.sort_by(|a, b| natural_cmp(&a.0, &b.0));

    for (_, path) in files {
        if *remaining == 0 {
            return;
        }
        *remaining -= 1;
        out.push(path.to_string_lossy().into_owned());
    }
    for sub in dirs {
        walk_markdown_files(&sub, remaining, depth + 1, out);
    }
}

/// What a workspace holds, for the home screen's file browser: the number of
/// text documents under the root plus a bounded sample of their paths.
#[derive(serde::Serialize)]
pub struct WorkspaceFiles {
    pub count: usize,
    pub files: Vec<String>,
}

/// Every readable text document under `path`, recursively — the data behind the
/// home screen's "open folder and browse it" view, where the whole tree is laid
/// out at once instead of the sidebar's lazy one-level-at-a-time expansion.
///
/// Bounded by [`WORKSPACE_SCAN_MAX_DEPTH`] and [`WORKSPACE_SCAN_MAX_FILES`];
/// `count` is the real total found within those bounds, which is what the badge
/// shows. `files` is capped at [`WORKSPACE_SCAN_FILES_PREVIEW`] entries so the
/// payload stays small for a large workspace.
#[tauri::command]
pub fn list_workspace_files(path: String) -> Result<WorkspaceFiles, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(t!("workspace.not_a_dir", path = path).into_owned());
    }
    let mut remaining = WORKSPACE_SCAN_MAX_FILES;
    let found = scan_markdown_files(root, &mut remaining);
    let count = found.len();
    let files = found
        .into_iter()
        .take(WORKSPACE_SCAN_FILES_PREVIEW)
        .collect();
    Ok(WorkspaceFiles { count, files })
}

// ---- Wiki 链接 / Obsidian 嵌入解析 ----

/// A resolved `[[wiki target]]`: the on-disk path plus optional file content
/// and heading section used by Obsidian-style embeds.
#[derive(serde::Serialize)]
pub struct WikiResolution {
    pub path: Option<String>,
    pub content: Option<String>,
    pub section: Option<String>,
    pub matched_by: String,
}

/// Candidate file names for a wiki target with no extension. Markdown targets
/// commonly omit `.md`, so try the common text extensions before searching.
fn wiki_candidates(target: &str) -> Vec<String> {
    let has_ext = Path::new(target).extension().is_some();
    if has_ext {
        vec![target.to_string()]
    } else {
        ALLOWED_TEXT_EXTENSIONS
            .iter()
            .map(|ext| format!("{target}.{ext}"))
            .collect()
    }
}

fn find_in_dir(dir: &Path, target: &str) -> Option<PathBuf> {
    for candidate in wiki_candidates(target) {
        let path = dir.join(&candidate);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

/// Breadth-first search for a file whose stem or file name matches `target`.
/// Bounded by the same depth/file budget as the workspace scan.
fn find_by_name(root: &Path, target: &str) -> Option<PathBuf> {
    let target_lower = target.to_lowercase();
    let mut queue = vec![(root.to_path_buf(), 0usize)];
    let mut visited = 0usize;
    while let Some((dir, depth)) = queue.pop() {
        if depth > WORKSPACE_SCAN_MAX_DEPTH || visited > WORKSPACE_SCAN_MAX_FILES {
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited > WORKSPACE_SCAN_MAX_FILES {
                break;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            match entry.file_type() {
                Ok(ft) if ft.is_dir() => {
                    if !is_ignored_workspace_dir(&name) {
                        queue.push((path, depth + 1));
                    }
                }
                Ok(ft) if ft.is_file() => {
                    let stem = Path::new(&name)
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_lowercase())
                        .unwrap_or_default();
                    if stem == target_lower || name.to_lowercase() == target_lower {
                        return Some(path);
                    }
                }
                _ => {}
            }
        }
    }
    None
}

/// Extract a heading section: from a heading whose text matches `section`
/// (case-insensitive, leading `#` stripped) up to the next heading of the same
/// or higher level.
fn extract_section(content: &str, section: &str) -> Option<String> {
    let wanted = section.trim().trim_start_matches('#').trim().to_lowercase();
    let lines: Vec<&str> = content.lines().collect();
    let mut start = None;
    let mut level = 0usize;
    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        let hashes = trimmed.chars().take_while(|c| *c == '#').count();
        if hashes == 0 || hashes > 6 {
            continue;
        }
        let text = trimmed[hashes..].trim().trim_end_matches('#').trim().to_lowercase();
        if start.is_none() && text == wanted {
            start = Some(idx);
            level = hashes;
            continue;
        }
        if let Some(begin) = start {
            if hashes <= level {
                return Some(lines[begin..idx].join("\n"));
            }
        }
    }
    start.map(|begin| lines[begin..].join("\n"))
}

/// Resolve a wiki target against the workspace root, then the current
/// document's directory, then a bounded name search. `target#heading` selects a
/// heading section when the target is a text document.
#[tauri::command]
pub fn resolve_wiki_target(
    root: String,
    from_path: String,
    target: String,
) -> Result<WikiResolution, String> {
    let (name, section) = match target.split_once('#') {
        Some((name, section)) => (name.trim().to_string(), Some(section.trim().to_string())),
        None => (target.trim().to_string(), None),
    };
    if name.is_empty() {
        return Ok(WikiResolution {
            path: None,
            content: None,
            section: None,
            matched_by: "empty".into(),
        });
    }

    let root_path = Path::new(&root);
    let from_dir = Path::new(&from_path).parent().unwrap_or(root_path);
    let mut matched = find_in_dir(from_dir, &name)
        .map(|p| (p, "relative".to_string()))
        .or_else(|| find_in_dir(root_path, &name).map(|p| (p, "root".to_string())))
        .or_else(|| find_by_name(root_path, &name).map(|p| (p, "search".to_string())));

    if matched.is_none() {
        // Absolute paths typed directly into the wiki syntax.
        let direct = Path::new(&name);
        if direct.is_file() {
            matched = Some((direct.to_path_buf(), "absolute".into()));
        }
    }

    let Some((path, matched_by)) = matched else {
        return Ok(WikiResolution {
            path: None,
            content: None,
            section: None,
            matched_by: "missing".into(),
        });
    };

    // Canonicalize before returning: a wiki target like `../public/logo.png`
    // resolves through `..`, and the asset protocol refuses un-normalized
    // paths containing `..`. Canonicalizing also resolves symlinks.
    let path = fs::canonicalize(&path).unwrap_or(path);

    let content = if has_allowed_extension(&path) {
        fs::read_to_string(&path).ok()
    } else {
        None
    };
    let section_content = match (&content, &section) {
        (Some(content), Some(section)) if !section.is_empty() => extract_section(content, section),
        _ => None,
    };

    Ok(WikiResolution {
        path: Some(strip_verbatim_prefix(path.to_string_lossy().into_owned())),
        content,
        section: section_content,
        matched_by,
    })
}

/// Image extensions the editor's "insert image" action accepts.
const ALLOWED_IMAGE_EXTENSIONS: &[&str] =
    &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"];

/// Folder the editor creates beside a document to hold the images it imports.
const IMAGE_FOLDER: &str = "docs";

fn has_allowed_image_extension(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            ALLOWED_IMAGE_EXTENSIONS
                .iter()
                .any(|a| a.eq_ignore_ascii_case(e))
        })
        .unwrap_or(false)
}

/// Where an imported image ended up, for the editor to reference and display.
#[derive(serde::Serialize)]
pub struct ImportedImage {
    /// Absolute path of the file on disk (what the webview loads).
    pub abs: String,
    /// Markdown-relative path from the document's directory, `/`-separated.
    pub rel: String,
}

/// Bring a picked image beside `document_path` so the markdown can reference it
/// with a portable relative path instead of an absolute one.
///
/// An image already inside the document's directory is referenced where it is —
/// copying would only duplicate a file the document tree already ships. Anything
/// from outside is copied into `<document dir>/docs/` (created on demand). Name
/// collisions get a `-1`, `-2`, … suffix, unless an identical file is already
/// there, in which case it is reused so re-inserting the same image is a no-op.
///
/// `rel` comes back `/`-separated with spaces percent-encoded, ready to drop
/// straight into `![](...)`.
#[tauri::command]
pub fn import_image(document_path: String, source_path: String) -> Result<ImportedImage, String> {
    let source = Path::new(&source_path);
    if !has_allowed_image_extension(source) {
        return Err(t!("image.not_image", path = source_path).into_owned());
    }
    if !source.is_file() {
        return Err(t!("image.not_found", path = source_path).into_owned());
    }
    // Canonicalize so symlinks and `..` cannot redirect the copy elsewhere.
    let source =
        fs::canonicalize(source).map_err(|e| t!("image.resolve_failed", path = source_path, error = e).into_owned())?;

    let doc_dir = Path::new(&document_path)
        .parent()
        .ok_or_else(|| t!("image.no_parent", path = document_path).into_owned())?;
    let doc_dir = fs::canonicalize(doc_dir)
        .map_err(|e| t!("image.resolve_dir_failed", error = e).into_owned())?;

    let target = if source.starts_with(&doc_dir) {
        source.clone()
    } else {
        let folder = doc_dir.join(IMAGE_FOLDER);
        fs::create_dir_all(&folder)
            .map_err(|e| t!("image.create_folder_failed", folder = folder.display(), error = e).into_owned())?;
        let name = source
            .file_name()
            .ok_or_else(|| t!("image.no_file_name", path = source_path).into_owned())?;
        let (target, needs_copy) = unique_target(&folder, name, &source);
        if needs_copy {
            fs::copy(&source, &target)
                .map_err(|e| t!("image.copy_failed", folder = folder.display(), error = e).into_owned())?;
        }
        target
    };

    Ok(ImportedImage {
        rel: markdown_relative_path(&doc_dir, &target),
        abs: strip_verbatim_prefix(target.to_string_lossy().into_owned()),
    })
}

/// A path inside `folder` for `name` that either does not exist yet, or already
/// holds a byte-identical copy of `source` (reuse instead of piling up `-1`,
/// `-2` duplicates of the same picture). The bool is "must copy".
fn unique_target(folder: &Path, name: &std::ffi::OsStr, source: &Path) -> (PathBuf, bool) {
    let candidate = folder.join(name);
    if !candidate.exists() {
        return (candidate, true);
    }
    if files_equal(&candidate, source) {
        return (candidate, false);
    }

    let stem = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");
    let ext = Path::new(name).extension().and_then(|s| s.to_str());
    let mut n = 1u32;
    loop {
        let file = match ext {
            Some(ext) => format!("{stem}-{n}.{ext}"),
            None => format!("{stem}-{n}"),
        };
        let candidate = folder.join(file);
        if !candidate.exists() {
            return (candidate, true);
        }
        if files_equal(&candidate, source) {
            return (candidate, false);
        }
        n += 1;
    }
}

fn files_equal(a: &Path, b: &Path) -> bool {
    match (fs::read(a), fs::read(b)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

/// Path from `from_dir` to `to_file`, `/`-separated with spaces percent-encoded
/// so it stays a single markdown token. Both arguments are absolute.
fn markdown_relative_path(from_dir: &Path, to_file: &Path) -> String {
    let from: Vec<_> = from_dir.components().collect();
    let to: Vec<_> = to_file.components().collect();
    let mut common = 0;
    // Stop one short of `to`'s end so the file name itself is never matched.
    while common < from.len() && common < to.len() - 1 && from[common] == to[common] {
        common += 1;
    }

    let mut parts: Vec<String> = Vec::new();
    for _ in common..from.len() {
        parts.push("..".to_string());
    }
    for component in &to[common..] {
        parts.push(component.as_os_str().to_string_lossy().into_owned());
    }
    parts.join("/").replace(' ', "%20")
}

/// Allow the webview's asset protocol to serve specific image files — but only
/// files a document is entitled to.
///
/// The frontend resolves every local `<img src>` to an absolute path during
/// rendering and hands the list here. Each path is canonicalized (so symlinks
/// cannot smuggle a file in) and must sit inside one of the document's asset
/// roots, see [`asset_roots`]. Anything else is refused and returned to the
/// caller so it can be logged. The only files the webview can ever fetch are
/// the ones a document legitimately referenced from its own tree.
///
/// Why the bound matters: DOMPurify is the main thing between a markdown file
/// and script execution in the webview. Without this check a document could
/// write `![x](../../../.ssh/id_rsa)` and make that file fetchable, so a single
/// sanitizer bypass would have been a file-exfiltration primitive across the
/// whole disk. Now it is bounded to what the user opened.
#[tauri::command]
pub fn allow_assets(
    app: AppHandle,
    document_path: String,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let (allowed, rejected) = partition_assets(Path::new(&document_path), &paths);
    let scope = app.asset_protocol_scope();
    for p in &allowed {
        scope
            .allow_file(p)
            .map_err(|e| t!("asset.allow_failed", path = p.display(), error = e).into_owned())?;
    }
    Ok(rejected)
}

/// Split the requested asset paths into the canonical files that may be
/// served and the requests that must be refused. Pure so it can be tested
/// without an app handle.
pub fn partition_assets(document_path: &Path, paths: &[String]) -> (Vec<PathBuf>, Vec<String>) {
    let ceiling = home_dir().and_then(|h| fs::canonicalize(h).ok());
    partition_assets_below(document_path, paths, ceiling.as_deref())
}

/// [`partition_assets`] with an explicit ceiling for the git-root walk; see
/// [`git_root`]. Split out so the ceiling is testable without a real home.
fn partition_assets_below(
    document_path: &Path,
    paths: &[String],
    ceiling: Option<&Path>,
) -> (Vec<PathBuf>, Vec<String>) {
    let roots = asset_roots(document_path, ceiling);
    let mut allowed = Vec::new();
    let mut rejected = Vec::new();
    for p in paths {
        match fs::canonicalize(p) {
            Ok(c) if c.is_file() && roots.iter().any(|r| c.starts_with(r)) => allowed.push(c),
            _ => rejected.push(p.clone()),
        }
    }
    (allowed, rejected)
}

/// The directory trees a document may load images from: the directory the
/// document lives in — widened to the enclosing git checkout when there is
/// one, because `docs/guide.md` referencing `../assets/diagram.png` is how
/// repositories are laid out.
///
/// Everything is canonicalized so comparison happens on real paths. A document
/// that does not exist on disk contributes no root.
fn asset_roots(document_path: &Path, ceiling: Option<&Path>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(doc) = fs::canonicalize(document_path) {
        if let Some(dir) = doc.parent() {
            roots.push(git_root(dir, ceiling).unwrap_or_else(|| dir.to_path_buf()));
        }
    }
    roots
}

/// Nearest ancestor (including `dir` itself) that holds a `.git` entry — a
/// directory for a normal checkout, a file for worktrees and submodules.
///
/// The walk never reaches `ceiling` (the home directory in production), any
/// ancestor of it, or a filesystem root. Without that, a dotfiles repo at
/// `~/.git` would widen every document under home to the whole home
/// directory — exactly the exposure this bound exists to remove.
fn git_root(dir: &Path, ceiling: Option<&Path>) -> Option<PathBuf> {
    dir.ancestors()
        .take_while(|a| a.parent().is_some() && ceiling.map_or(true, |c| !c.starts_with(a)))
        .find(|a| a.join(".git").exists())
        .map(Path::to_path_buf)
}

#[cfg(test)]
mod test_support {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// A fresh directory per call — tests run on threads and share one
    /// process::id(), so the counter is what keeps directories distinct.
    pub fn scratch(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "openmd-{}-{}-{}",
            prefix,
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}

#[cfg(test)]
mod fs_scope_tests {
    use super::{has_allowed_extension, read_markdown_file};
    use super::test_support::scratch;
    use std::path::Path;

    #[test]
    fn text_extensions_are_allowed_case_insensitively() {
        for ok in ["/x/a.md", "/x/a.MARKDOWN", "/x/a.Txt", "/x/a.mkd", "/x/a.mdx"] {
            assert!(has_allowed_extension(Path::new(ok)), "{ok} should be allowed");
        }
    }

    #[test]
    fn sensitive_and_extensionless_paths_are_refused() {
        for bad in [
            "/home/u/.ssh/id_rsa",
            "/home/u/.ssh/authorized_keys",
            "/etc/passwd",
            "/home/u/.bashrc",
            "/home/u/a.sh",
            "/home/u/a.exe",
            "/home/u/Makefile",
        ] {
            assert!(!has_allowed_extension(Path::new(bad)), "{bad} should be refused");
        }
    }

    #[test]
    fn read_rejects_a_non_text_path_before_touching_disk() {
        rust_i18n::set_locale("en");
        // The path does not exist; the extension guard must fire first, so the
        // error is the refusal, never a "file not found".
        let err = read_markdown_file("/home/u/.ssh/id_rsa".into()).unwrap_err();
        assert!(err.contains("Refusing to read"), "got: {err}");
    }

    #[test]
    fn a_utf8_bom_is_returned_to_the_caller_untouched() {
        // The BOM is stripped in the renderer, not here, keeping the read
        // non-destructive.
        let dir = scratch("bom");
        let file = dir.join("bom.md");
        std::fs::write(&file, b"\xEF\xBB\xBF# Head\n").unwrap();

        let got = read_markdown_file(file.to_string_lossy().into_owned()).unwrap();
        assert_eq!(got, "\u{FEFF}# Head\n");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_non_utf8_file_reports_the_encoding_rather_than_the_io_error() {
        rust_i18n::set_locale("en");
        // Notepad offers UTF-16 in the same Save As dropdown that produces a
        // BOM. `read_to_string` rejects it with "stream did not contain valid
        // UTF-8", which tells a user nothing actionable.
        let dir = scratch("utf16");
        let file = dir.join("utf16.md");
        // UTF-16 LE BOM followed by "# Hi"
        std::fs::write(&file, b"\xFF\xFE\x23\x00\x20\x00\x48\x00\x69\x00").unwrap();

        let err = read_markdown_file(file.to_string_lossy().into_owned()).unwrap_err();
        assert!(err.contains("not UTF-8 encoded"), "got: {err}");
        assert!(err.contains("Re-save it as UTF-8"), "got: {err}");
        assert!(!err.contains("stream did not contain"), "raw io error leaked: {err}");

        std::fs::remove_dir_all(&dir).ok();
    }
}

#[cfg(test)]
mod write_tests {
    use super::test_support::scratch;
    use super::{read_markdown_file, write_markdown_file};

    #[test]
    fn write_refuses_a_non_text_path_before_touching_disk() {
        rust_i18n::set_locale("en");
        // The path does not exist; the extension guard must fire first, so the
        // error is the refusal, never an io error.
        let err = write_markdown_file("/home/u/a.sh".into(), "x".into()).unwrap_err();
        assert!(err.contains("Refusing to write"), "got: {err}");
    }

    #[test]
    fn write_then_read_round_trips_the_content() {
        let dir = scratch("write");
        let file = dir.join("note.md");
        write_markdown_file(file.to_string_lossy().into_owned(), "# Hi 中文\n".into()).unwrap();

        let got = read_markdown_file(file.to_string_lossy().into_owned()).unwrap();
        assert_eq!(got, "# Hi 中文\n");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_refuses_a_directory_with_a_text_extension() {
        rust_i18n::set_locale("en");
        // A directory named `folder.md` passes the extension guard; the
        // is_file check is what keeps the io error meaningful.
        let dir = scratch("write");
        let folder = dir.join("folder.md");
        std::fs::create_dir_all(&folder).unwrap();

        let err = write_markdown_file(folder.to_string_lossy().into_owned(), "x".into()).unwrap_err();
        assert!(err.contains("Not a file"), "got: {err}");
        std::fs::remove_dir_all(&dir).ok();
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::strip_verbatim_prefix;

    #[test]
    fn strips_the_verbatim_prefix_canonicalize_returns() {
        assert_eq!(
            strip_verbatim_prefix(r"\\?\C:\Users\hugo\a.md".to_string()),
            r"C:\Users\hugo\a.md"
        );
        assert_eq!(
            strip_verbatim_prefix(r"\\?\UNC\server\share\a.md".to_string()),
            r"\\server\share\a.md"
        );
        assert_eq!(
            strip_verbatim_prefix(r"C:\Users\hugo\a.md".to_string()),
            r"C:\Users\hugo\a.md"
        );
    }
}

#[cfg(test)]
mod workspace_tests {
    use super::test_support::scratch;
    use super::{list_workspace_dir, natural_cmp};
    use std::cmp::Ordering;
    use std::fs;
    use std::path::Path;

    #[test]
    fn natural_order_is_numeric_for_digit_runs() {
        assert_eq!(natural_cmp("a2", "a10"), Ordering::Less);
        assert_eq!(natural_cmp("10", "9"), Ordering::Greater);
        assert_eq!(natural_cmp("a02", "a2"), Ordering::Less, "tie falls back to bytes");
        assert_eq!(natural_cmp("Note", "note"), Ordering::Less, "case tie falls back to bytes");
        assert_eq!(natural_cmp("第2章", "第10章"), Ordering::Less);
    }

    #[test]
    fn listing_hides_junk_dirs_shows_dirs_first_and_sorts_naturally() {
        let dir = scratch("ws-list");
        fs::create_dir_all(dir.join("notes")).unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::create_dir_all(dir.join("node_modules")).unwrap();
        fs::create_dir_all(dir.join(".hidden")).unwrap();
        fs::write(dir.join("b.md"), "x").unwrap();
        fs::write(dir.join("a10.md"), "x").unwrap();
        fs::write(dir.join("a2.md"), "x").unwrap();
        fs::write(dir.join("pic.png"), "x").unwrap();
        fs::write(dir.join("notes").join("deep.md"), "x").unwrap();

        let got = list_workspace_dir(dir.to_string_lossy().into_owned()).unwrap();
        let names: Vec<&str> = got.iter().map(|e| e.name.as_str()).collect();
        // 递归内容不展开(lazy),非 md 文件不出现,隐藏/node_modules 被跳过
        assert_eq!(names, vec!["notes", "a2.md", "a10.md", "b.md"]);
        assert!(got[0].is_dir);
        assert!(!got[1].is_dir);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn listing_refuses_a_non_directory() {
        assert!(list_workspace_dir("/definitely/not/a/dir/openmd".into()).is_err());
    }

    #[test]
    fn scan_finds_documents_at_every_depth_in_natural_order() {
        let dir = scratch("ws-scan");
        // 两条分支:一条只有一层,一条再深一层(顺带验证深度优先的递归顺序)
        fs::create_dir_all(dir.join("notes").join("sub")).unwrap();
        fs::create_dir_all(dir.join("notes").join("deep")).unwrap();
        fs::write(dir.join("b.md"), "x").unwrap();
        fs::write(dir.join("a10.md"), "x").unwrap();
        fs::write(dir.join("a2.md"), "x").unwrap();
        fs::write(dir.join("notes").join("sub").join("n2.md"), "x").unwrap();
        fs::write(dir.join("notes").join("deep").join("deep.md"), "x").unwrap();

        let mut remaining = 5000;
        let found = super::scan_markdown_files(&dir, &mut remaining);

        let names: Vec<String> = found
            .iter()
            .map(|p| {
                Path::new(p)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        // 本层文件按自然序在前,然后才是子目录(深度优先)
        assert_eq!(names, vec!["a2.md", "a10.md", "b.md", "deep.md", "n2.md"]);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_skips_hidden_dirs_dependency_farms_and_non_text_files() {
        let dir = scratch("ws-scan-junk");
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::create_dir_all(dir.join("node_modules").join("pkg")).unwrap();
        fs::create_dir_all(dir.join(".hidden")).unwrap();
        fs::write(dir.join("keep.md"), "x").unwrap();
        fs::write(dir.join("pic.png"), "x").unwrap();
        fs::write(dir.join("script.sh"), "x").unwrap();
        fs::write(dir.join(".git").join("hidden.md"), "x").unwrap();
        fs::write(dir.join("node_modules").join("pkg").join("dep.md"), "x").unwrap();
        fs::write(dir.join(".hidden").join("hidden.md"), "x").unwrap();

        let mut remaining = 5000;
        let found = super::scan_markdown_files(&dir, &mut remaining);

        assert_eq!(found.len(), 1, "only keep.md survives: {found:?}");
        assert!(found[0].ends_with("keep.md"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_stops_exactly_at_the_depth_limit() {
        // 深度语义钉死:level k 的文件在 walk 里正好处于 depth k,而 depth 达到
        // WORKSPACE_SCAN_MAX_DEPTH 的目录不再进入。所以「第 MAX_DEPTH-1 层必须
        // 找得到、第 MAX_DEPTH 层必须找不到」才能发现 off-by-N —— 只断言"深链里
        // 只找到根上那个文件"的话,把上限改成 1 也照样绿。
        let dir = scratch("ws-scan-depth-exact");
        let mut level = dir.clone();
        let mut deepest_ok: Option<std::path::PathBuf> = None;
        for depth in 1..=super::WORKSPACE_SCAN_MAX_DEPTH {
            level = level.join("d");
            fs::create_dir_all(&level).unwrap();
            if depth == super::WORKSPACE_SCAN_MAX_DEPTH - 1 {
                deepest_ok = Some(level.clone());
            }
        }
        let inside = deepest_ok.expect("构造了至少一层");
        fs::write(inside.join("inside.md"), "x").unwrap();
        fs::write(level.join("past-limit.md"), "x").unwrap();

        let mut remaining = 5000;
        let found = super::scan_markdown_files(&dir, &mut remaining);

        let names: Vec<String> = found
            .iter()
            .map(|p| Path::new(p).file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            names,
            vec!["inside.md"],
            "第 {} 层要找到,第 {} 层不许进",
            super::WORKSPACE_SCAN_MAX_DEPTH - 1,
            super::WORKSPACE_SCAN_MAX_DEPTH
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_workspace_files_caps_the_preview_but_reports_the_real_count() {
        let dir = scratch("ws-files-preview");
        let extra = super::WORKSPACE_SCAN_FILES_PREVIEW + 7;
        for i in 0..extra {
            fs::write(dir.join(format!("f{i:04}.md")), "x").unwrap();
        }

        let got = super::list_workspace_files(dir.to_string_lossy().into_owned()).unwrap();

        assert_eq!(got.count, extra, "count 是真实总数");
        assert_eq!(
            got.files.len(),
            super::WORKSPACE_SCAN_FILES_PREVIEW,
            "files 只给预览条数"
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_respects_the_file_budget() {
        let dir = scratch("ws-scan-budget");
        for i in 0..10 {
            fs::write(dir.join(format!("f{i}.md")), "x").unwrap();
        }

        let mut remaining = 4;
        let found = super::scan_markdown_files(&dir, &mut remaining);

        assert_eq!(found.len(), 4, "budget caps the walk: {found:?}");
        assert_eq!(remaining, 0);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_workspace_files_reports_the_count_and_refuses_a_non_directory() {
        let dir = scratch("ws-files");
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("a.md"), "x").unwrap();
        fs::write(dir.join("sub").join("b.md"), "x").unwrap();
        fs::write(dir.join("sub").join("skip.png"), "x").unwrap();

        let got = super::list_workspace_files(dir.to_string_lossy().into_owned()).unwrap();
        assert_eq!(got.count, 2);
        assert_eq!(got.files.len(), 2);

        assert!(super::list_workspace_files("/definitely/not/a/dir/openmd".into()).is_err());

        fs::remove_dir_all(&dir).ok();
    }
}

#[cfg(test)]
mod asset_scope_tests {
    use super::test_support::scratch;
    use super::{partition_assets, partition_assets_below};
    use std::fs;
    use std::path::Path;

    fn touch(path: &Path) -> String {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"x").unwrap();
        path.to_string_lossy().into_owned()
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn accepts_an_image_beside_the_document_and_returns_it_canonical() {
        let dir = scratch("asset-scope");
        let doc = dir.join("note.md");
        touch(&doc);
        let pic = touch(&dir.join("pic.png"));

        let (allowed, rejected) = partition_assets(&doc, &[pic.clone()]);

        assert_eq!(allowed, vec![fs::canonicalize(&pic).unwrap()]);
        assert!(rejected.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn accepts_images_in_subfolders_of_the_document() {
        let dir = scratch("asset-scope");
        let doc = dir.join("note.md");
        touch(&doc);
        let pic = touch(&dir.join("img").join("deep").join("pic.png"));

        let (allowed, rejected) = partition_assets(&doc, &[pic]);

        assert_eq!(allowed.len(), 1);
        assert!(rejected.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rejects_traversal_above_the_document_tree() {
        let dir = scratch("asset-scope");
        let doc = dir.join("notes").join("note.md");
        touch(&doc);
        let secret = touch(&dir.join("secret.txt"));
        // Exactly what `![x](../secret.txt)` resolves to in the renderer.
        let traversal = s(&dir.join("notes").join("..").join("secret.txt"));

        let (allowed, rejected) = partition_assets(&doc, &[secret.clone(), traversal.clone()]);

        assert!(allowed.is_empty());
        assert_eq!(rejected, vec![secret, traversal]);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn widens_to_the_enclosing_git_checkout_but_no_further() {
        let dir = scratch("asset-scope");
        let repo = dir.join("repo");
        fs::create_dir_all(repo.join(".git")).unwrap();
        let doc = repo.join("docs").join("guide.md");
        touch(&doc);
        let inside = touch(&repo.join("assets").join("diagram.png"));
        let above = touch(&dir.join("outside.png"));

        let (allowed, rejected) = partition_assets(&doc, &[inside.clone(), above.clone()]);

        assert_eq!(allowed, vec![fs::canonicalize(&inside).unwrap()]);
        assert_eq!(rejected, vec![above]);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn never_widens_to_the_ceiling_or_above_it() {
        // A dotfiles checkout at ~/.git must not turn "~" into an asset root.
        let dir = scratch("asset-scope");
        let home = dir.join("home");
        fs::create_dir_all(home.join(".git")).unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap(); // and one above home
        let doc = home.join("notes").join("note.md");
        touch(&doc);
        let elsewhere = touch(&home.join("Pictures").join("pic.png"));
        let beside = touch(&home.join("notes").join("pic.png"));
        let ceiling = fs::canonicalize(&home).unwrap();

        let (allowed, rejected) =
            partition_assets_below(&doc, &[elsewhere.clone(), beside.clone()], Some(&ceiling));

        assert_eq!(allowed, vec![fs::canonicalize(&beside).unwrap()]);
        assert_eq!(rejected, vec![elsewhere]);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_checkout_below_the_ceiling_still_widens() {
        let dir = scratch("asset-scope");
        let home = dir.join("home");
        let repo = home.join("code").join("repo");
        fs::create_dir_all(repo.join(".git")).unwrap();
        let doc = repo.join("docs").join("guide.md");
        touch(&doc);
        let inside = touch(&repo.join("assets").join("d.png"));
        let ceiling = fs::canonicalize(&home).unwrap();

        let (allowed, rejected) = partition_assets_below(&doc, &[inside], Some(&ceiling));

        assert_eq!(allowed.len(), 1);
        assert!(rejected.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_git_file_marks_a_checkout_too() {
        // Worktrees and submodules keep a `.git` *file*, not a directory.
        let dir = scratch("asset-scope");
        let repo = dir.join("wt");
        touch(&repo.join(".git"));
        let doc = repo.join("docs").join("guide.md");
        touch(&doc);
        let inside = touch(&repo.join("assets").join("diagram.png"));

        let (allowed, _) = partition_assets(&doc, &[inside]);

        assert_eq!(allowed.len(), 1);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rejects_missing_files_and_directories() {
        let dir = scratch("asset-scope");
        let doc = dir.join("note.md");
        touch(&doc);
        fs::create_dir_all(dir.join("folder")).unwrap();
        let missing = s(&dir.join("nope.png"));
        let folder = s(&dir.join("folder"));

        let (allowed, rejected) = partition_assets(&doc, &[missing.clone(), folder.clone()]);

        assert!(allowed.is_empty());
        assert_eq!(rejected, vec![missing, folder]);
        fs::remove_dir_all(&dir).ok();
    }
}
