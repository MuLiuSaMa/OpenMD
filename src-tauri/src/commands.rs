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

fn has_allowed_extension(p: &Path) -> bool {
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
