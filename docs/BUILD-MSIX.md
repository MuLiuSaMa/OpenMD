# 微软商店(MSIX)打包指南

OpenMD 通过 `msix/` 目录下的脚本打 MSIX 包上架微软商店,流水线与 NexBox 相同:

```
pnpm tauri:build:store   # 商店版构建(隐藏商店外入口)
pnpm msix                # 生成 AppxManifest + Assets + resources.pri → makeappx 打包
pnpm msix:install        # 本地侧载测试(自动提权 + 导入证书)
```

## 前置条件

1. **Windows 10/11 SDK**:打包脚本需要 SDK 里的 `makeappx.exe`、`makepri.exe`、`signtool.exe`(默认装在 `C:\Program Files (x86)\Windows Kits\10\bin`)。
2. **Partner Center 开发者账号**:个人或公司账号,需完成身份与税务验证。
3. 在 Partner Center 的 **Apps and Games → New product** 保留应用名(如 `OpenMD`)。

## 包身份(Identity)

MSIX 的身份来自打包脚本参数,**与 `tauri.conf.json` 的 `identifier` 无关**(后者不要改,改了会导致普通版用户的设置目录迁移):

| 参数 | 默认值 | 说明 |
|---|---|---|
| `-IdentityName` | `MuLiuSaMa.OpenMD` | **必须与 Partner Center 保留的应用名完全一致**,不一致时用此参数覆盖 |
| `-Publisher` | `CN=30F199CB-855A-42F4-96A9-F43088B508BF` | Partner Center「账户设置」里的 Publisher,同一开发者账号不用改 |
| `-PublisherDisplayName` | `MuLiu_SaMa` | 商店页面展示的发布者名 |

```powershell
pnpm msix -IdentityName 你在PartnerCenter保留的名字
```

## 上架流程

1. **商店版构建**(不要用普通 `pnpm tauri build` 的 exe 打包):

   ```powershell
   pnpm tauri:build:store
   ```

   商店版通过 `vite build --mode store`(读取 `.env.store`)启用,依据微软政策
   [10.1.5 / 10.2.3](https://learn.microsoft.com/legal/windows/agreements/store-policies#10105-personal-information)
   隐藏以下商店外入口:

   - 关于页作者行的三个平台标签(小黑盒 / Bilibili / 抖音)
   - 设置页「QQ群」「赞助」两个栏目
   - 状态栏「作者:木流」文案
   - 应用内更新全部入口(启动检查、托盘「检查更新」、关于页检查按钮、更新弹窗)——更新由商店接管
   - 设置页「文件关联」开关(注册表写入在 MSIX 下被虚拟化,关联改由 AppxManifest 声明)

2. **打包**:

   ```powershell
   pnpm msix                # 产出 msix/out/OpenMD_{version}_x64.msix(自签,供侧载)
   pnpm msix -SkipSign      # 未签名包,商店提交用
   ```

3. **本地侧载测试**(Windows 10 需开启"旁加载应用",Windows 11 默认允许):

   ```powershell
   pnpm msix:install        # 或双击 msix/install-msix.ps1
   ```

   逐项检查:设置弹窗只剩 通用/外观/关于;关于页无平台标签和检查更新按钮;状态栏无作者文案;
   托盘菜单无「检查更新」;任务栏图标无底板;双击 `.md` 可用 OpenMD 打开。

4. **提交**:在 Partner Center 上传**未签名** msix(`pnpm msix -SkipSign` 的产物,
   商店会用自己的证书重签),填写商店资料、分级和定价后提交审核。

## 常见问题

- **预处理错误 5001**:AppxManifest 的 capabilities 保持了最小集(仅 `runFullTrust`),
  不要加 `unvirtualizedResources` 等受限能力;`makepri` 的 config 刻意不含 `packaging` 段,
  避免商店端拆包校验失败(NexBox 踩过的坑)。
- **任务栏图标带底板**:确认包内有 `Square44x44Logo.targetsize-*_altform-unplated.png`
  变体(`build-msix.ps1` 每次都会重新生成)。
- **找不到 SDK 工具**:安装 Windows 10/11 SDK 的 "Windows SDK Signing Tools for Desktop Apps"。
- **找不到 exe**:先跑 `pnpm tauri:build:store` 再打包;脚本只认
  `src-tauri/target/release/openmd.exe`。

## 脚本一览

| 文件 | 作用 |
|---|---|
| `msix/build-msix.ps1` | 组装 staging(openmd.exe + Assets + AppxManifest + resources.pri)→ makeappx 打包 → 可选自签 |
| `msix/install-msix.ps1` | UAC 提权 → 导入证书到 TrustedPeople/Root → 移除旧包 → Add-AppxPackage |
