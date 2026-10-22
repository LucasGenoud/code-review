import { expect, it } from "vitest";
import { compactPaths } from "./file-tree";

const files = ["src/a.ts", "src/lib/b.ts", "src/lib/c.ts", "README.md"].map((path) => ({ path }));

it("sends fully picked folders as the folder", () => {
  expect(compactPaths(files, new Set(["src/lib/b.ts", "src/lib/c.ts", "README.md"]))).toEqual(["src/lib", "README.md"]);
  expect(compactPaths(files, new Set(["src/a.ts", "src/lib/b.ts"]))).toEqual(["src/lib/b.ts", "src/a.ts"]);
  expect(compactPaths(files, new Set(files.map((f) => f.path)))).toEqual(["src", "README.md"]);
});

it("keeps merged single-folder chains whole", () => {
  const deep = [{ path: "a/b/x.ts" }, { path: "a/b/y.ts" }, { path: "z.ts" }];
  expect(compactPaths(deep, new Set(["a/b/x.ts", "a/b/y.ts"]))).toEqual(["a/b"]);
});
