//! 运行时检测是否以 MSIX 包身份运行(微软商店版 / 侧载包)。
//!
//! 用 [`GetCurrentPackageFullName`] 探测:普通 exe 返回
//! APPMODEL_ERROR_NO_PACKAGE(15700),有包身份则返回缓冲区需求长度。

#[cfg(windows)]
pub fn is_msix() -> bool {
    use windows_sys::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;

    const ERROR_SUCCESS: u32 = 0;
    const ERROR_INSUFFICIENT_BUFFER: u32 = 122;

    let mut len: u32 = 0;
    let rc = unsafe { GetCurrentPackageFullName(&mut len, std::ptr::null_mut()) };
    rc == ERROR_SUCCESS || rc == ERROR_INSUFFICIENT_BUFFER
}

#[cfg(not(windows))]
pub fn is_msix() -> bool {
    false
}
