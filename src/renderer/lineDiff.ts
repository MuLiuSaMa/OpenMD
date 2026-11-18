export type DiffLineKind = "equal" | "add" | "remove" | "empty";

export interface DiffRow {
  leftLine: number | null;
  leftText: string;
  leftKind: DiffLineKind;
  rightLine: number | null;
  rightText: string;
  rightKind: DiffLineKind;
}

export interface DiffResult {
  rows: DiffRow[];
  added: number;
  removed: number;
}

/**
 * 基于 Myers/LCS 的轻量级逐行对照 Diff，生成左右并排渲染行。
 * 对超大文件做行数保护，避免 O(N*M) 内存爆炸。
 */
export function computeSideBySideDiff(leftInput: string, rightInput: string): DiffResult {
  const a = leftInput.replace(/\r\n/g, "\n").split("\n");
  const b = rightInput.replace(/\r\n/g, "\n").split("\n");
  const n = a.length;
  const m = b.length;

  // 若行数过大（如 > 4000 行），退化为按行直接对比以保证响应速度。
  if (n * m > 4_000_000) {
    const maxLen = Math.max(n, m);
    const rows: DiffRow[] = [];
    let added = 0;
    let removed = 0;
    for (let i = 0; i < maxLen; i++) {
      const hasL = i < n;
      const hasR = i < m;
      if (hasL && hasR && a[i] === b[i]) {
        rows.push({
          leftLine: i + 1,
          leftText: a[i],
          leftKind: "equal",
          rightLine: i + 1,
          rightText: b[i],
          rightKind: "equal",
        });
      } else {
        if (hasL) removed++;
        if (hasR) added++;
        rows.push({
          leftLine: hasL ? i + 1 : null,
          leftText: hasL ? a[i] : "",
          leftKind: hasL ? "remove" : "empty",
          rightLine: hasR ? i + 1 : null,
          rightText: hasR ? b[i] : "",
          rightKind: hasR ? "add" : "empty",
        });
      }
    }
    return { rows, added, removed };
  }

  // 标准 DP LCS 表
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i];
    const nextRow = dp[i + 1];
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        row[j] = nextRow[j + 1] + 1;
      } else {
        row[j] = nextRow[j] >= row[j + 1] ? nextRow[j] : row[j + 1];
      }
    }
  }

  type Op = { kind: "equal" | "remove" | "add"; text: string; line: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "equal", text: a[i], line: i + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "remove", text: a[i], line: i + 1 });
      i++;
    } else {
      ops.push({ kind: "add", text: b[j], line: j + 1 });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: "remove", text: a[i], line: i + 1 });
    i++;
  }
  while (j < m) {
    ops.push({ kind: "add", text: b[j], line: j + 1 });
    j++;
  }

  // 将连续的 remove 与 add 配对为并排行
  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  let rLine = 1;
  let idx = 0;

  while (idx < ops.length) {
    const op = ops[idx];
    if (op.kind === "equal") {
      rows.push({
        leftLine: op.line,
        leftText: op.text,
        leftKind: "equal",
        rightLine: rLine++,
        rightText: op.text,
        rightKind: "equal",
      });
      idx++;
      continue;
    }

    const removes: Op[] = [];
    const adds: Op[] = [];
    while (idx < ops.length && ops[idx].kind === "remove") {
      removes.push(ops[idx]);
      idx++;
    }
    while (idx < ops.length && ops[idx].kind === "add") {
      adds.push(ops[idx]);
      idx++;
    }

    const pairCount = Math.max(removes.length, adds.length);
    for (let k = 0; k < pairCount; k++) {
      const rem = removes[k];
      const add = adds[k];
      if (rem) removed++;
      if (add) added++;
      rows.push({
        leftLine: rem ? rem.line : null,
        leftText: rem ? rem.text : "",
        leftKind: rem ? "remove" : "empty",
        rightLine: add ? rLine++ : null,
        rightText: add ? add.text : "",
        rightKind: add ? "add" : "empty",
      });
    }
  }

  return { rows, added, removed };
}
