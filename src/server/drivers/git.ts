import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { FileChange } from "@/lib/domain";

const exec = promisify(execFile);

// Diffs and file dumps can be large.
const MAX_BUFFER = 256 * 1024 * 1024;

// fileMode off: Windows bind mounts report every file as chmod-changed.
// quotepath off: keep non-ASCII paths readable instead of octal-escaped.
// autocrlf input: Windows checkouts hold CRLF; without the host's autocrlf
//   every line of every file reads as changed, e.g. a whole-repo diff.
// checkStat minimal, trustctime off: bind mounts report other inodes and
//   ctimes than the host index holds, forcing git to re-read every file.
const BASE_ARGS = [
  "-c", "core.fileMode=false",
  "-c", "core.quotepath=off",
  "-c", "core.autocrlf=input",
  "-c", "core.checkStat=minimal",
  "-c", "core.trustctime=false",
];

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

// Recent commits reachable from `ref`, or from every ref when null.
export async function commits(dir: string, limit: number, ref: string | null): Promise<CommitInfo[]> {
  const format = ["%H", "%h", "%s", "%an", "%cI"].join(FIELD_SEP);
  const from = ref ? ["--end-of-options", ref] : ["--all"];
  let out: string;
  try {
    out = await git(dir, ["log", `-n${limit}`, `--format=${format}`, ...from]);
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

export type ChangedFile = { path: string; change: FileChange };

// Porcelain status letter → change. Anything else (M, T, U) is a modification.
const STATUS_CHANGE: Record<string, FileChange> = {
  "?": FileChange.Added,
  A: FileChange.Added,
  D: FileChange.Deleted,
  R: FileChange.Renamed,
  C: FileChange.Added,
};

const STATUS_PATH_START = 3;

// Working tree and index changes against HEAD, untracked files included.
// One `git status`: cheaper than diffing contents.
//   "R  new\0old\0" ← renames and copies carry their source as an extra entry
export async function changedFiles(dir: string): Promise<ChangedFile[]> {
  const out = await git(dir, ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const entries = out.split("\0").filter(Boolean);
  const files: ChangedFile[] = [];

  for (let i = 0; i < entries.length; i++) {
    // "XY path": X = index, Y = working tree.
    const entry = entries[i];
    const letter = entry[0] === " " ? entry[1] : entry[0];
    files.push({ path: entry.slice(STATUS_PATH_START), change: STATUS_CHANGE[letter] ?? FileChange.Modified });

    if (letter === "R" || letter === "C") {
      i++;
    }
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
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
