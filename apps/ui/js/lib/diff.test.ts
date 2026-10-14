import { parsePatch } from "@/lib/diff";

test("splits a patch per file and numbers its lines", () => {
  const patch = [
    "diff --git a/config/routes.rb b/config/routes.rb",
    "index 1..2 100644",
    "--- a/config/routes.rb",
    "+++ b/config/routes.rb",
    "@@ -1,3 +1,4 @@ Rails.application.routes.draw do",
    " a",
    "+b",
    "-c",
    " d",
    "diff --git a/logo.png b/logo.png",
    "Binary files a/logo.png and b/logo.png differ",
  ].join("\n");
  const files = parsePatch(patch);
  expect(files.map((f) => f.path)).toEqual(["config/routes.rb", "logo.png"]);
  expect(files[0].hunks[0].lines).toEqual([
    { kind: "ctx", text: "a", old: 1, new: 1 },
    { kind: "add", text: "b", new: 2 },
    { kind: "del", text: "c", old: 2 },
    { kind: "ctx", text: "d", old: 3, new: 3 },
  ]);
  expect(files[1].binary).toBe(true);
});
