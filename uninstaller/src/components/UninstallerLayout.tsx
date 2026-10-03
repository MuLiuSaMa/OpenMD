import type { ReactNode } from "react";

interface UninstallerLayoutProps {
  children: ReactNode;
}

/**
 * 持久化外壳：中间居中文字 Logo，下方内容区按卸载步骤切换。与安装器同款布局。
 */
export default function UninstallerLayout({ children }: UninstallerLayoutProps) {
  return (
    <div className="installer-app">
      <div className="tagline">
        <img src="/logo/wordmark.png" alt="OpenMD" draggable={false} />
      </div>

      <div className="installer-content">{children}</div>
    </div>
  );
}
