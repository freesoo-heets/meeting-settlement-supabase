// 줄 단위 변경 내역 (봇관리). 봇이 남기는 기록(difflib)과 같은 unified diff 글자로 주고받는다

export type DiffLine = { kind: "add" | "del" | "same" | "hunk"; text: string; oldNo?: number; newNo?: number };

const MAX_CELLS = 4000000; // 바뀐 부분이 이보다 크면 줄을 맞춰 보지 않고 통째로 바뀐 것으로 본다

type Op = { kind: "add" | "del" | "same"; text: string };

function splitLines(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function middleOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) return [...a.map((text) => ({ kind: "del" as const, text })), ...b.map((text) => ({ kind: "add" as const, text }))];
  const size = m + 1;
  const table = new Uint32Array((n + 1) * size);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * size + j] = a[i] === b[j] ? table[(i + 1) * size + j + 1] + 1 : Math.max(table[(i + 1) * size + j], table[i * size + j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (i < n && (j >= m || table[(i + 1) * size + j] >= table[i * size + j + 1])) {
      ops.push({ kind: "del", text: a[i] });
      i += 1;
    } else {
      ops.push({ kind: "add", text: b[j] });
      j += 1;
    }
  }
  return ops;
}

export function unifiedDiff(oldText: string, newText: string, context = 3) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const ops: Op[] = [
    ...a.slice(0, head).map((text) => ({ kind: "same" as const, text })),
    ...middleOps(a.slice(head, a.length - tail), b.slice(head, b.length - tail)),
    ...a.slice(a.length - tail).map((text) => ({ kind: "same" as const, text })),
  ];

  const out: string[] = [];
  let at = 0;
  let oldNo = 1;
  let newNo = 1;
  while (at < ops.length) {
    if (ops[at].kind === "same") {
      at += 1;
      oldNo += 1;
      newNo += 1;
      continue;
    }
    // 바뀐 곳 앞뒤로 context 줄씩 묶는다. 사이가 가까운 변경은 한 덩어리
    const before = Math.min(context, at);
    let end = at;
    let last = at;
    while (end < ops.length && end - last <= context * 2) {
      if (ops[end].kind !== "same") last = end;
      end += 1;
    }
    const stop = Math.min(ops.length, last + context + 1);
    const lines = ops.slice(at - before, stop);
    const oldCount = lines.filter((op) => op.kind !== "add").length;
    const newCount = lines.filter((op) => op.kind !== "del").length;
    out.push(`@@ -${oldNo - before},${oldCount} +${newNo - before},${newCount} @@`);
    for (const op of lines) out.push(`${op.kind === "add" ? "+" : op.kind === "del" ? "-" : " "}${op.text}`);
    for (const op of ops.slice(at, stop)) {
      if (op.kind !== "add") oldNo += 1;
      if (op.kind !== "del") newNo += 1;
    }
    at = stop;
  }
  return out.join("\n");
}

export function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const line of diff.split("\n")) {
    if (!line || line.startsWith("---") || line.startsWith("+++")) continue;
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      lines.push({ kind: "hunk", text: line });
    } else if (line[0] === "+") {
      lines.push({ kind: "add", text: line.slice(1), newNo: newNo++ });
    } else if (line[0] === "-") {
      lines.push({ kind: "del", text: line.slice(1), oldNo: oldNo++ });
    } else if (line[0] === " ") {
      lines.push({ kind: "same", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    } else {
      lines.push({ kind: "hunk", text: line }); // 생략 안내
    }
  }
  return lines;
}

export function diffCount(diff: string) {
  const lines = parseDiff(diff);
  return { plus: lines.filter((line) => line.kind === "add").length, minus: lines.filter((line) => line.kind === "del").length };
}
