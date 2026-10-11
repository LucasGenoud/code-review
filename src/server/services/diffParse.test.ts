import { describe, expect, it } from "vitest";
import { FileChange } from "@/lib/domain";
import { addedFilePatch, formatHunks, LineKind, parseDiff } from "./diffParse";

const DIFF = `diff --git a/shop/orders.py b/shop/orders.py
index 1111111..2222222 100644
--- a/shop/orders.py
+++ b/shop/orders.py
@@ -1,3 +1,4 @@ imports
 from shop.db import connect
+from shop.discounts import apply_discount

-x = 1
+x = 2
\\ No newline at end of file
diff --git a/new.py b/new.py
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.py
@@ -0,0 +1,2 @@
+a = 1
+b = 2
diff --git a/gone.py b/gone.py
deleted file mode 100644
--- a/gone.py
+++ /dev/null
@@ -1 +0,0 @@
-old
diff --git a/old name.py b/new name.py
similarity index 100%
rename from old name.py
rename to new name.py
diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
`;

describe("parseDiff", () => {
  const files = parseDiff(DIFF);

  it("splits files and detects change kinds", () => {
    expect(files.map((f) => [f.path, f.change])).toEqual([
      ["shop/orders.py", FileChange.Modified],
      ["new.py", FileChange.Added],
      ["gone.py", FileChange.Deleted],
      ["new name.py", FileChange.Renamed],
      ["logo.png", FileChange.Modified],
    ]);
    expect(files[3].oldPath).toBe("old name.py");
    expect(files[4].binary).toBe(true);
  });

  it("numbers lines on both sides and skips no-newline markers", () => {
    const lines = files[0].hunks[0].lines;
    expect(lines).toHaveLength(5);
    expect(lines[1]).toEqual({ kind: LineKind.Add, text: "from shop.discounts import apply_discount", oldNo: null, newNo: 2 });
    expect(lines[3]).toEqual({ kind: LineKind.Del, text: "x = 1", oldNo: 3, newNo: null });
    expect(lines[4]).toEqual({ kind: LineKind.Add, text: "x = 2", oldNo: null, newNo: 4 });
  });

  it("keeps each file's raw patch", () => {
    expect(files[1].patch.startsWith("diff --git a/new.py")).toBe(true);
    expect(files[1].patch).toContain("+b = 2\n");
  });
});

describe("addedFilePatch", () => {
  it("marks every line added", () => {
    const f = addedFilePatch("a.py", "x\r\ny\n");
    expect(f.hunks[0].lines.map((l) => [l.newNo, l.text])).toEqual([[1, "x"], [2, "y"]]);
    expect(parseDiff(f.patch)[0].hunks[0].lines).toHaveLength(2);
  });
});

describe("formatHunks", () => {
  it("prints new line numbers, blank for removed lines", () => {
    const text = formatHunks(parseDiff(DIFF)[0].hunks);
    expect(text).toContain("    2 + from shop.discounts import apply_discount");
    expect(text).toContain("      - x = 1");
  });
});
