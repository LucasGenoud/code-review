import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import { DiffMode } from "@/lib/domain";
import { loadChanges, resolveSource, type DiffSource } from "./diff";

// Scope: a review limited to some files and folders, on a real repo.
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "prr-scope-"));

function git(...args: string[]) {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
}

beforeAll(() => {
  git("init", "-q", "-b", "main");
  fs.mkdirSync(path.join(repo, "src", "lib"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "a.ts"), "a\n");
  fs.writeFileSync(path.join(repo, "src", "lib", "b.ts"), "b\n");
  fs.writeFileSync(path.join(repo, "srcx.ts"), "x\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  // Uncommitted: one edit, one untracked file.
  fs.writeFileSync(path.join(repo, "src", "a.ts"), "a2\n");
  fs.writeFileSync(path.join(repo, "src", "lib", "c.ts"), "c\n");
});

async function paths(source: DiffSource): Promise<string[]> {
  const files = await loadChanges(repo, source, await resolveSource(repo, source));
  return files.map((f) => f.path).sort();
}

it("reviews whole picked files and folders, not look-alike names", async () => {
  expect(await paths({ mode: DiffMode.Files, base: null, head: null, paths: ["src/lib", "srcx.ts"] })).toEqual([
    "src/lib/b.ts",
    "src/lib/c.ts",
    "srcx.ts",
  ]);
});

it("limits a diff to its scope", async () => {
  const uncommitted = { mode: DiffMode.Uncommitted, base: null, head: null };
  expect(await paths({ ...uncommitted, paths: null })).toEqual(["src/a.ts", "src/lib/c.ts"]);
  expect(await paths({ ...uncommitted, paths: ["src/lib"] })).toEqual(["src/lib/c.ts"]);
});
