# ============================================================
# OpenMD MSIX 打包脚本(上架微软商店 / 本地侧载)
# 参考 NexBox 的 msix 流水线移植。
#
# 前置:
#   1. Windows 10/11 SDK(需要 makeappx / makepri / signtool)
#   2. 先产出商店版 exe:pnpm tauri:build:store
#      (商店版构建会隐藏 平台标签 / QQ群 / 赞助 / 应用内更新 等入口)
#
# 产出:msix/out/OpenMD_{version}_x64.msix
#   - 本地侧载测试:默认自签,配 msix/install-msix.ps1 使用
#   - 商店提交:pnpm msix -SkipSign 产未签名包直接上传(商店会重签)
# ============================================================
param(
    # 包身份:必须与 Partner Center 保留的应用名一致
    [string]$IdentityName = "MuLiuSaMa.OpenMD",
    # 发布者:Partner Center「账户设置」里的 Publisher(含 CN= 前缀)
    [string]$Publisher = "CN=30F199CB-855A-42F4-96A9-F43088B508BF",
    [string]$PublisherDisplayName = "MuLiu_SaMa",
    # 覆盖版本号(默认读 src-tauri/tauri.conf.json 的 version)
    [string]$VersionOverride = "",
    # 自签证书密码(仅本地侧载用)
    [string]$CertPassword = "openmd-msix",
    # 跳过签名(商店提交包)
    [switch]$SkipSign
)

$ErrorActionPreference = "Stop"
$Root     = Split-Path -Parent $PSScriptRoot
$WorkDir  = Join-Path $PSScriptRoot "work"
$OutDir   = Join-Path $PSScriptRoot "out"
$Stage    = Join-Path $WorkDir "stage"
$Assets   = Join-Path $Stage "Assets"
$IconsDir = Join-Path $Root "src-tauri\icons"
$ExePath  = Join-Path $Root "src-tauri\target\release\openmd.exe"

function Invoke-Tool {
    param([string]$Exe, [string[]]$ToolArgs)
    & $Exe @ToolArgs
    if ($LASTEXITCODE -ne 0) { throw "$([IO.Path]::GetFileName($Exe)) 失败(退出码 $LASTEXITCODE)" }
}

# 1. 版本号:tauri.conf.json 的三段版本补齐为 MSIX 四段(1.0.2 -> 1.0.2.0)
$ConfPath = Join-Path $Root "src-tauri\tauri.conf.json"
$Version = if ($VersionOverride) { $VersionOverride } else {
    # PS5.1 默认按 ANSI 读文件,配置含中文必须显式 UTF8
    (Get-Content $ConfPath -Raw -Encoding UTF8 | ConvertFrom-Json).version
}
if ($Version -notmatch '^\d+(\.\d+){3}$') {
    $p = $Version.Split('.'); while ($p.Count -lt 4) { $p += '0' }
    $Version = $p -join '.'
}
Write-Host "==> OpenMD v$Version -> $IdentityName"

# 2. exe(商店提交必须用商店版构建产出)
if (-not (Test-Path $ExePath)) {
    throw "找不到 $ExePath`n请先运行: pnpm tauri:build:store"
}

# 3. 定位 Windows SDK 工具(x64,取版本号最新的)
function Find-SdkTool {
    param([string]$Name)
    $bin = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    if (-not (Test-Path $bin)) { throw "未找到 Windows SDK,请安装 Windows 10/11 SDK(需要 $Name)" }
    foreach ($d in Get-ChildItem $bin -Directory | Sort-Object Name -Descending) {
        $p = Join-Path $d.FullName "x64\$Name"
        if (Test-Path $p) { return $p }
    }
    throw "Windows SDK 中未找到 $Name"
}
$MakeAppx = Find-SdkTool "makeappx.exe"
$MakePri  = Find-SdkTool "makepri.exe"
$Signtool = Find-SdkTool "signtool.exe"

# 4. staging:openmd.exe(前端资源已内嵌)+ AppxManifest + Assets
if (Test-Path $WorkDir) { Remove-Item $WorkDir -Recurse -Force }
New-Item -ItemType Directory -Path $Assets -Force | Out-Null
Copy-Item $ExePath (Join-Path $Stage "openmd.exe")

# 5. Assets:tauri icon 已生成的三张基底 + System.Drawing 派生变体。
#    任务栏图标无底板依赖 *_altform-unplated 变体,必须随包重新生成。
Add-Type -AssemblyName System.Drawing
function Resize-Png {
    param([string]$Src, [string]$Dst, [int]$Size)
    $img = [System.Drawing.Image]::FromFile($Src)
    try {
        $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.DrawImage($img, 0, 0, $Size, $Size)
        $g.Dispose()
        $bmp.Save($Dst, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
    } finally { $img.Dispose() }
}
foreach ($f in @("Square44x44Logo.png", "Square150x150Logo.png", "StoreLogo.png")) {
    Copy-Item (Join-Path $IconsDir $f) $Assets
}
$IconPng = Join-Path $IconsDir "icon.png"
# Square44x44:targetsize + unplated 变体
foreach ($n in @(16, 20, 24, 30, 32, 36, 40, 44, 48, 60, 64, 72, 80, 96, 256)) {
    $dst = Join-Path $Assets "Square44x44Logo.targetsize-$n.png"
    Resize-Png $IconPng $dst $n
    Copy-Item $dst (Join-Path $Assets "Square44x44Logo.targetsize-${n}_altform-unplated.png")
}
# scale 变体(44 / 150 / StoreLogo)
foreach ($m in @(@(100, 44), @(125, 55), @(150, 66), @(200, 88), @(400, 176))) {
    Resize-Png $IconPng (Join-Path $Assets "Square44x44Logo.scale-$($m[0]).png") $m[1]
}
foreach ($m in @(@(100, 150), @(125, 188), @(150, 225), @(200, 300), @(400, 375))) {
    Resize-Png $IconPng (Join-Path $Assets "Square150x150Logo.scale-$($m[0]).png") $m[1]
}
foreach ($m in @(@(100, 50), @(125, 63), @(150, 75), @(200, 100), @(400, 125))) {
    Resize-Png $IconPng (Join-Path $Assets "StoreLogo.scale-$($m[0]).png") $m[1]
}

# 6. AppxManifest
#    - 应用内文件关联开关在 MSIX 下被注册表虚拟化,关联改由 manifest 声明
#    - capabilities 保持最小:unvirtualizedResources 会触发商店预处理 5001 错误(NexBox 教训)
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
  <Identity Name="$IdentityName"
            Publisher="$Publisher"
            Version="$Version"
            ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>OpenMD</DisplayName>
    <PublisherDisplayName>$PublisherDisplayName</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="zh-cn" />
    <Resource Language="zh-tw" />
    <Resource Language="en-us" />
    <Resource Language="ja" />
  </Resources>
  <Applications>
    <Application Id="OpenMD"
                 Executable="openmd.exe"
                 EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="OpenMD"
        Description="简洁 美观 高效的 Markdown 查看器"
        BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png" />
      <Extensions>
        <!-- 文件关联由包声明(应用内开关在 MSIX 下注册表写入被虚拟化) -->
        <uap:Extension Category="windows.fileTypeAssociation">
          <uap:FileTypeAssociation Name="openmd.markdown">
            <uap:SupportedFileTypes>
              <uap:FileType>.md</uap:FileType>
              <uap:FileType>.markdown</uap:FileType>
              <uap:FileType>.mdown</uap:FileType>
              <uap:FileType>.mkd</uap:FileType>
            </uap:SupportedFileTypes>
          </uap:FileTypeAssociation>
        </uap:Extension>
      </Extensions>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@
Set-Content -Path (Join-Path $Stage "AppxManifest.xml") -Value $manifest -Encoding UTF8

# 7. resources.pri:先用 makepri 生成标准 config,再剥掉 packaging 段,
#    避免拆包触发商店预处理 5001(NexBox 教训)
$PriConfig = Join-Path $WorkDir "priconfig.xml"
Invoke-Tool $MakePri @("createconfig", "/cf", $PriConfig, "/pv", "10.0.0", "/dq", "zh-cn", "/o")
$xml = [xml](Get-Content $PriConfig -Raw -Encoding UTF8)
$packNode = $xml.SelectSingleNode("//*[local-name()='packaging']")
if ($packNode) { [void]$packNode.ParentNode.RemoveChild($packNode) }
$xml.Save($PriConfig)
Invoke-Tool $MakePri @("new", "/pr", $Stage, "/cf", $PriConfig, "/of", (Join-Path $Stage "resources.pri"), "/o")

# 8. makeappx 打包
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$MsixPath = Join-Path $OutDir "OpenMD_${Version}_x64.msix"
Invoke-Tool $MakeAppx @("pack", "/o", "/d", $Stage, "/p", $MsixPath)

# 9. 自签(本地侧载;商店提交用 -SkipSign 上传未签名包,商店会重签)
if (-not $SkipSign) {
    $Pfx = Join-Path $WorkDir "openmd-selfsigned.pfx"
    $cert = Get-ChildItem Cert:\CurrentUser\My |
        Where-Object { $_.Subject -eq $Publisher } |
        Sort-Object NotAfter -Descending | Select-Object -First 1
    if (-not $cert) {
        Write-Host "==> 创建自签名证书 $Publisher"
        $cert = New-SelfSignedCertificate -Type Custom `
            -Subject $Publisher `
            -KeyUsage DigitalSignature `
            -FriendlyName "OpenMD MSIX self-signed" `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -NotAfter (Get-Date).AddYears(3) `
            -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
    }
    $sec = ConvertTo-SecureString -String $CertPassword -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath $Pfx -Password $sec | Out-Null
    Invoke-Tool $Signtool @("sign", "/fd", "SHA256", "/a", "/f", $Pfx, "/p", $CertPassword, $MsixPath)
}

Write-Host ""
Write-Host "==> 完成: $MsixPath"
if ($SkipSign) {
    Write-Host "    未签名包:直接上传 Partner Center(商店会重签)"
} else {
    Write-Host "    本地侧载测试: pnpm msix:install(或双击 msix/install-msix.ps1)"
}
