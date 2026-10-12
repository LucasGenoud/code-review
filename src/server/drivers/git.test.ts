import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import { FileChange } from "@/lib/domain";
import { changedFiles, diff, wordUsages } from "./git";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prr-git-"));
let nextRepo = 0;

// Docker's git sees none of the host's config, e.g. core.autocrlf=true.
beforeAll(() => {
  const empty = path.join(tmp, "empty.gitconfig");
  fs.writeFileSync(empty, "");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.GIT_CONFIG_GLOBAL = empty;
});

function git(repo: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" });
}

function repoWith(files: Record<string, string>, autocrlf = "false"): string {
  const repo = path.join(tmp, `repo-${nextRepo++}`);
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(repo, name), text);
  }

  git(repo, "-c", `core.autocrlf=${autocrlf}`, "add", ".");
  git(repo, "commit", "-qm", "Base");
  return repo;
}

it("ignores CRLF-only working tree changes", async () => {
  // Windows checkout with autocrlf: LF in git, CRLF on disk.
  const repo = repoWith({ "a.ts": "one\r\ntwo\r\n" }, "true");

  expect(await diff(repo, "HEAD", null)).toBe("");
  expect(await changedFiles(repo)).toEqual([]);
});

it("lists modified, added, deleted, renamed and untracked files", async () => {
  const repo = repoWith({ "mod.ts": "a\n", "gone.ts": "b\n", "old name.ts": "c\n" });
  fs.writeFileSync(path.join(repo, "mod.ts"), "a2\n");
  fs.rmSync(path.join(repo, "gone.ts"));
  git(repo, "mv", "old name.ts", "new name.ts");
  fs.mkdirSync(path.join(repo, "dir"));
  fs.writeFileSync(path.join(repo, "dir", "new.ts"), "d\n");

  expect(await changedFiles(repo)).toEqual([
    { path: "dir/new.ts", change: FileChange.Added },
    { path: "gone.ts", change: FileChange.Deleted },
    { path: "mod.ts", change: FileChange.Modified },
    { path: "new name.ts", change: FileChange.Renamed },
  ]);
});

it("finds whole-word usages at a commit or in the working tree", async () => {
  const repo = repoWith({ "Pay.java": "long r = balance(inv);\nlong balanced = 0;\n" });
  const sha = git(repo, "rev-parse", "HEAD").trim();
  fs.writeFileSync(path.join(repo, "New.java"), "balance(x);\n");

  // The commit doesn't see untracked files and drops git's "<sha>:" prefix.
  expect(await wordUsages(repo, "balance", sha, 0)).toBe("Pay.java:1:long r = balance(inv);\n");
  expect(await wordUsages(repo, "balance", sha, 1)).toBe("Pay.java:1:long r = balance(inv);\nPay.java-2-long balanced = 0;\n");
  expect(await wordUsages(repo, "balance", null, 0)).toContain("New.java:1:balance(x);");
  expect(await wordUsages(repo, "missing", sha, 0)).toBe("");
});
