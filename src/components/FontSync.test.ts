import { describe, expect, it } from "vitest";
import { buildFontFamily, formatFontStack } from "./FontSync";

describe("FontSync helpers", () => {
  it("quotes custom font names and preserves generic families", () => {
    expect(formatFontStack("JetBrains Mono")).toBe('"JetBrains Mono"');
    expect(formatFontStack("Inter, Microsoft YaHei, sans-serif")).toBe(
      '"Inter", "Microsoft YaHei", sans-serif',
    );
  });

  it("prepends English then Chinese custom fonts before fallback", () => {
    expect(buildFontFamily(["JetBrains Mono", "Microsoft YaHei"], "monospace")).toBe(
      '"JetBrains Mono", "Microsoft YaHei", monospace',
    );
    expect(buildFontFamily(["", "  "], "monospace")).toBe("monospace");
  });
});
