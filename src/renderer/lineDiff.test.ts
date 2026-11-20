import { describe, expect, it } from "vitest";
import { computeSideBySideDiff } from "./lineDiff";

describe("computeSideBySideDiff", () => {
  it("reports zero changes for identical text", () => {
    const res = computeSideBySideDiff("a\nb\nc", "a\nb\nc");
    expect(res.added).toBe(0);
    expect(res.removed).toBe(0);
    expect(res.rows).toHaveLength(3);
    expect(res.rows.every((r) => r.leftKind === "equal" && r.rightKind === "equal")).toBe(true);
  });

  it("pairs removed and added lines side by side", () => {
    const res = computeSideBySideDiff("line1\nold\nline3", "line1\nnew\nextra\nline3");
    expect(res.removed).toBe(1);
    expect(res.added).toBe(2);
    expect(res.rows[1].leftKind).toBe("remove");
    expect(res.rows[1].leftText).toBe("old");
    expect(res.rows[1].rightKind).toBe("add");
    expect(res.rows[1].rightText).toBe("new");
    expect(res.rows[2].leftKind).toBe("empty");
    expect(res.rows[2].rightKind).toBe("add");
    expect(res.rows[2].rightText).toBe("extra");
  });
});
