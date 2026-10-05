# 在 macOS 上构建 OpenMD

上游仓库只发布了 Windows 版本（README 的构建流程依赖 PowerShell 与自研安装器），
但主程序本身是 **Tauri 2 + React**，本体是跨平台的。本仓库已补齐 macOS 适配，
在 Apple Silicon / Intel Mac 上可以直接构建出原生 `.app`。

## 前置依赖

| 依赖 | 版本 | 安装 |
| --- | --- | --- |
| Xcode Command Line Tools | 最新 | `xcode-select --install` |
| Rust | stable | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh -s -- -y` |
| Node.js | ≥ 20 | 任选 nvm / 官网安装包 |
| pnpm | ≥ 9 | `npm i -g pnpm` |

Rust 安装后需让 `cargo` 进入 `PATH`：

```bash
source "$HOME/.cargo/env"
```

## 构建

```bash
pnpm install
pnpm tauri build
```

产物：

```
src-tauri/target/release/bundle/macos/OpenMD.app
```

首次构建需要编译整个 Rust 依赖树，约 5–10 分钟；之后增量构建约 1–2 分钟。

## 安装

```bash
cp -R src-tauri/target/release/bundle/macos/OpenMD.app /Applications/
open /Applications/OpenMD.app
```

`.app` 是自签名（ad-hoc）的。**本机构建的产物没有隔离属性（quarantine），可直接运行。**
如果是从网盘/浏览器下载的副本，首次打开会被 Gatekeeper 拦下：

```bash
xattr -dr com.apple.quarantine /Applications/OpenMD.app
```

## 制作 DMG（可选）

```bash
pnpm tauri build --bundles dmg
```

注意：Tauri 用 `create-dmg` 生成带自定义窗口排版的 DMG，这一步会通过 AppleScript
驱动 Finder。若脚本卡住或报 `failed to run bundle_dmg.sh`，是系统未授予终端
「自动化 / 辅助功能」权限所致，请在
「系统设置 → 隐私与安全性 → 自动化」中允许终端控制「访达(Finder)」后重试，
或直接分发 `.app` / 用 `hdiutil` 手工打包：

```bash
hdiutil create -volname OpenMD -srcfolder OpenMD.app -ov -format UDZO OpenMD.dmg
```

## macOS 适配改动

上游代码本身已用 `#[cfg]` 分平台隔离了 Windows 专有逻辑（注册表、exe 图标提取、
ShellExecuteW 等），因此移植不需要重写主体。本仓库补的差异如下：

| 文件 | 改动 |
| --- | --- |
| `src-tauri/tauri.macos.conf.json` | 平台覆盖：`decorations: true` + `titleBarStyle: "Overlay"`，保留原生红绿灯按钮 |
| `src-tauri/tauri.conf.json` | macOS 包元信息（category、最低系统版本）；`targets: ["app"]` |
| `src-tauri/src/lib.rs` | 处理 `RunEvent::Opened`（Finder「用 OpenMD 打开」/ 拖到 Dock 的入口）；macOS 点红灯改为隐藏窗口而非退出 |
| `src-tauri/src/editors.rs` | macOS 版「用其他程序打开」：扫描 `.app` + 解析 `Info.plist` 的 `CFBundleDocumentTypes` + Launch Services 默认处理程序 |
| `src-tauri/src/tray.rs` | 菜单栏改用单色 template 图标，适配深浅色 |
| `src/utils/platform.ts` | 前端平台判断 |
| `src/components/TitleBar.tsx` | macOS 下给红绿灯留出左侧空档 |
| `src/components/WindowControls.tsx` | macOS 下不再自绘窗口按钮（避免与原生红绿灯重复） |
| `src-tauri/src/watcher.rs` | 修正硬编码 Windows 路径的单元测试，使其跨平台 |

### 功能差异

- `detect_editors` / `open_file_with` 在 macOS 上走 `open -a`，可用应用列表来自
  本机 `.app` 扫描，因此列表内容与 Windows 版不同。
- 「检查更新」与 `.md` 关联注册仍是 Windows 专有实现，macOS 上分别表现为
  报错与不可用；`.md` 关联改由 `Info.plist` 的 `CFBundleDocumentTypes` 静态声明，
  安装后由系统「打开方式」管理。
- 未做的事：代码签名与公证（需要 Apple Developer 账号，且仅影响对外分发）。
