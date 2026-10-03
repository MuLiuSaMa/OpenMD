fn main() {
    // Read main app version from project root Cargo.toml
    let main_cargo = std::path::Path::new("../../src-tauri/Cargo.toml");
    if main_cargo.exists() {
        let content = std::fs::read_to_string(main_cargo).unwrap_or_default();
        for line in content.lines() {
            if let Some(ver) = line.strip_prefix("version = \"") {
                if let Some(end) = ver.find('\"') {
                    println!("cargo:rustc-env=OpenMD_APP_VERSION={}", &ver[..end]);
                    break;
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        use tauri_build::WindowsAttributes;
        // 兼容旧构建方式遗留的 STATIC_VCRUNTIME 环境变量(已废弃,存在即告警):
        // 在读取前移除,改用 static_vc_runtime(true) 静态链接 VC 运行库,
        // 确保安装包在没有 VC 运行库的机器上也能直接运行。
        std::env::remove_var("STATIC_VCRUNTIME");
        let windows = WindowsAttributes::new()
            .static_vc_runtime(true)
            .app_manifest(r#"
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="requireAdministrator" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
            "#);
        tauri_build::try_build(
            tauri_build::Attributes::new().windows_attributes(windows)
        ).expect("Failed to run build script");
    }
    #[cfg(not(target_os = "windows"))]
    {
        tauri_build::build();
    }
}
