import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

// Diffs and file dumps can be large.
const MAX_BUFFER = 256 * 1024 * 1024;

// fileMode off: Windows bind mounts report every file as chmod-changed.
// quotepath off: keep non-ASCII paths readable instead of octal-escaped.
const BASE_ARGS = ["-c", "core.fileMode=false", "-c", "core.quotepath=off"];

// git's well-known empty tree: diff base for a repo's first commit.
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const FIELD_SEP = "\x1f";
const NO_MATCH_EXIT = 1;

enum ExitPolicy {
  Strict,
  AllowNoMatch,
}

// Runs git in `dir`. Arguments go straight to the process, never a shell.
async function git(dir: string, args: string[], policy = ExitPolicy.Strict): Promise<string> {
  try {
    const { stdout } = await exec("git", [...BASE_ARGS, "-C", dir, ...args], {
      maxBuffer: MAX_BUFFER,
    });
    return stdout;
  } catch (e) {
    const err = e as { code?: number; stdout?: string };
    if (policy === ExitPolicy.AllowNoMatch && err.code === NO_MATCH_EXIT) {
      return err.stdout ?? "";
    }

    throw e;
  }
}

// Top-level folder of the repo containing `dir`, or null if not in a repo.
export async function repoRoot(dir: string): Promise<string | null> {
  try {
    const out = await git(dir, ["rev-parse", "--show-toplevel"]);
    return path.resolve(out.trim());
  } catch {
    return null;
  }
}

// Full sha of a commit-ish, or null if it doesn't resolve.
// e.g. "main" → "1e2c9e5…", "HEAD~1" on a root commit → null
export async function resolveCommit(dir: string, ref: string): Promise<string | null> {
  try {
    const out = await git(dir, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
    return out.trim();
  } catch {
    return null;
  }
}

export async function mergeBase(dir: string, a: string, b: string): Promise<string | null> {
  try {
    const out = await git(dir, ["merge-base", "--end-of-options", a, b]);
    return out.trim();
  } catch {
    return null;
  }
}

export async function branches(dir: string): Promise<string[]> {
  const out = await git(dir, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
    "refs/remotes",
  ]);
  return out.split("\n").filter((b) => b && !b.endsWith("/HEAD"));
}

export async function currentBranch(dir: string): Promise<string | null> {
  const out = await git(dir, ["branch", "--show-current"]);
  return out.trim() || null;
}

export type CommitInfo = { sha: string; short: string; subject: string; author: string; date: string };

export async function commits(dir: string, limit: number): Promise<CommitInfo[]> {
  const format = ["%H", "%h", "%s", "%an", "%cI"].join(FIELD_SEP);
  let out: string;
  try {
    out = await git(dir, ["log", "--all", `-n${limit}`, `--format=${format}`]);
  } catch {
    // Repo without commits.
    return [];
  }

  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, short, subject, author, date] = line.split(FIELD_SEP);
      return { sha, short, subject, author, date };
    });
}

// Unified diff from `base` to `head`. head null = working tree (staged + unstaged).
export async function diff(dir: string, base: string, head: string | null): Promise<string> {
  const args = [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--find-renames",
    "--unified=3",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    base,
  ];

  if (head) {
    args.push(head);
  }

  return git(dir, [...args, "--"]);
}

export async function untrackedFiles(dir: string): Promise<string[]> {
  const out = await git(dir, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return out.split("\0").filter(Boolean);
}

export async function trackedFiles(dir: string): Promise<string[]> {
  const out = await git(dir, ["ls-files", "-z"]);
  return out.split("\0").filter(Boolean);
}

// File content at a commit, or null if absent there.
export async function showFile(dir: string, sha: string, file: string): Promise<string | null> {
  try {
    return await git(dir, ["show", `${sha}:${file}`]);
  } catch {
    return null;
  }
}

// `git grep` over tracked files. Returns "path:line:text" lines.
export async function grep(dir: string, pattern: string, glob?: string): Promise<string> {
  const args = ["grep", "-n", "-I", "-E", "-e", pattern];
  if (glob) {
    args.push("--", glob);
  }

  return git(dir, args, ExitPolicy.AllowNoMatch);
}

export async function log(dir: string, file: string | undefined, limit: number): Promise<string> {
  const args = ["log", `-n${limit}`, "--format=%h %ad %an: %s", "--date=short"];
  if (file) {
    args.push("--", file);
  }

  return git(dir, args);
}
