# ============================================================
# OpenMD MSIX 侧载安装脚本(自动 UAC 提权版)
# 直接双击运行:自动请求管理员权限 -> 导入证书 -> 安装 MSIX
# 前置:先运行 pnpm msix(默认自签流程)产出 msix/out/*.msix
# ============================================================
param(
    [string]$MsixPath = "",
    # 包身份:与 build-msix.ps1 保持一致
    [string]$IdentityName = "MuLiuSaMa.OpenMD",
    [string]$CertPassword = "openmd-msix"
)

$ErrorActionPreference = "Stop"

# --- 自动 UAC 提权 ---
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process powershell.exe "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

# --- 找最新的 MSIX 包 ---
if (-not $MsixPath) {
    $latest = Get-ChildItem (Join-Path $PSScriptRoot "out") -Filter *.msix -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest) { $MsixPath = $latest.FullName }
}
if (-not $MsixPath -or -not (Test-Path $MsixPath)) {
    throw "未找到 MSIX 包,请先运行 pnpm msix"
}
Write-Host "==> 安装 $MsixPath"

# --- 导入签名证书到本机受信任存储(侧载信任链) ---
$Pfx = Join-Path $PSScriptRoot "work\openmd-selfsigned.pfx"
$signer = $null
if (Test-Path $Pfx) {
    $sec = ConvertTo-SecureString -String $CertPassword -Force -AsPlainText
    $signer = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($Pfx, $sec)
} else {
    # 打包脚本未导出 pfx 时,从包签名提取公钥证书
    $sig = Get-AuthenticodeSignature -FilePath $MsixPath
    if ($sig -and $sig.SignerCertificate) { $signer = $sig.SignerCertificate }
}
if (-not $signer) {
    throw "未能获取签名证书。未签名包(-SkipSign 产物)仅供商店提交,无法本地侧载;请运行 pnpm msix 重新打包。"
}
foreach ($storeName in @("TrustedPeople", "Root")) {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName, "LocalMachine")
    $store.Open("ReadWrite")
    $store.Add($signer)
    $store.Close()
}
Write-Host "==> 证书已导入 TrustedPeople / Root"

# --- 移除旧包后安装 ---
Get-AppxPackage -Name $IdentityName -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue
Add-AppxPackage -Path $MsixPath

Write-Host ""
Write-Host "==> 已安装,可在开始菜单搜索 OpenMD"
Write-Host "    卸载: 设置 > 应用,或 Get-AppxPackage $IdentityName | Remove-AppxPackage"
