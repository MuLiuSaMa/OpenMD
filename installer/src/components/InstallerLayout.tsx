import type { ReactNode } from "react";

interface InstallerLayoutProps {
  children: ReactNode;
}

/**
 * 持久化外壳：中间居中文字 Logo，下方内容区按安装步骤切换。
 */
export default function InstallerLayout({ children }: InstallerLayoutProps) {
  return (
    <div className="installer-app">
      <div className="tagline">
        <img src="/logo/wordmark.png" alt="OpenMD" draggable={false} />
      </div>

      <div className="installer-content">{children}</div>
    </div>
  );
}
