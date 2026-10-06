import { useSettings } from "../stores/settings";
import { useTabs } from "../stores/tabs";

/**
 * Open Markdown files that did not come from the workspace tree.
 *
 * Standalone documents should show their table of contents in the sidebar.
 * Files opened from the tree keep using `openPath` directly so that clicking a
 * nested file does not replace the current workspace.
 */
export async function openStandaloneFiles(paths: readonly string[]): Promise<void> {
  const files = paths.filter(Boolean);
  if (files.length === 0) return;

  const settings = useSettings.getState();
  settings.setSidebarTab("toc");
  if (!settings.tocOpen) settings.toggleToc();

  for (const path of files) {
    await useTabs.getState().openPath(path);
  }
}
