// Joins class names, skipping empty ones; an object adds each key whose value is truthy. Same as Rails class_names.
export function cx(...parts: (string | false | null | undefined | Record<string, unknown>)[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (typeof p === "string") out.push(p);
    else for (const [k, v] of Object.entries(p)) if (v) out.push(k);
  }
  return out.join(" ");
}
