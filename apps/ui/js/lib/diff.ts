// A unified patch, split per file into hunks and numbered lines.

export type Line = { kind: "ctx" | "add" | "del"; text: string; old?: number; new?: number };
export type Hunk = { header: string; lines: Line[] };
export type FileDiff = { path: string; old: string; hunks: Hunk[]; binary: boolean };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parsePatch(patch: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | undefined;
  let hunk: Hunk | undefined;
  let o = 0;
  let n = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(raw);
      file = { path: m?.[2] ?? raw.slice(11), old: m?.[1] ?? "", hunks: [], binary: false };
      files.push(file);
      hunk = undefined;
      continue;
    }
    if (!file) continue;
    const h = HUNK.exec(raw);
    if (h) {
      o = Number(h[1]);
      n = Number(h[2]);
      hunk = { header: raw, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      if (raw.startsWith("Binary files")) file.binary = true;
      if (raw.startsWith("rename to ")) file.path = raw.slice(10);
      continue;
    }
    if (raw.startsWith("+")) hunk.lines.push({ kind: "add", text: raw.slice(1), new: n++ });
    else if (raw.startsWith("-")) hunk.lines.push({ kind: "del", text: raw.slice(1), old: o++ });
    else if (raw.startsWith(" ")) hunk.lines.push({ kind: "ctx", text: raw.slice(1), old: o++, new: n++ });
  }
  return files;
}
