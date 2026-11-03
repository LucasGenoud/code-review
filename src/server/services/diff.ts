import path from "node:path";
import { z } from "zod";
import { DiffMode } from "@/lib/domain";
import { readBytes } from "@/server/drivers/fs";
import {
  changedBetween,
  diff,
  EMPTY_TREE,
  mergeBase,
  resolveCommit,
  showFile,
  trackedFiles,
  untrackedFiles,
  type ChangedFile,
} from "@/server/drivers/git";
import { addedFilePatch, parseDiff, type ParsedFile } from "./diffParse";
import { InputError } from "./errors";

// What to diff, as the user picked it.
//   uncommitted: HEAD → working tree (incl. untracked)
//   last_commit: HEAD~1 → HEAD
//   commits:     base → head
//   branches:    merge-base(base, head) → head   (like a PR: base...head)
//   files:       whole files of the working tree, as if newly added
//   pasted:      pasted text or dropped files, as if newly added
// paths limits the review to these files and folders, e.g. ["src/app", "README.md"].
export const sourceSchema = z.object({
  mode: z.enum(DiffMode),
  base: z.string().trim().nullable(),
  head: z.string().trim().nullable(),
  paths: z.array(z.string().min(1)).nullable(),
});

export type DiffSource = z.infer<typeof sourceSchema>;

// Pasted text, or a file dropped in the browser. name: e.g. "snippet.py".
export const pastedSchema = z
  .array(z.object({ name: z.string().trim().min(1), text: z.string() }))
  .refine((files) => new Set(files.map((f) => f.name)).size === files.length, "Pasted file names must be unique");

export type PastedFile = z.infer<typeof pastedSchema>[number];

// headSha null = working tree.
export type Resolved = { baseSha: string; headSha: string | null };

// Bytes git inspects to decide a file is binary.
const BINARY_SNIFF_BYTES = 8000;
const NUL = 0;

export async function resolveSource(dir: string, source: DiffSource): Promise<Resolved> {
  if (source.mode === DiffMode.Files || source.mode === DiffMode.Pasted) {
    return { baseSha: EMPTY_TREE, headSha: null };
  }

  if (source.mode === DiffMode.Uncommitted) {
    return { baseSha: (await resolveCommit(dir, "HEAD")) ?? EMPTY_TREE, headSha: null };
  }

  if (source.mode === DiffMode.LastCommit) {
    const head = await requireRef(dir, "HEAD");
    return { baseSha: (await resolveCommit(dir, "HEAD~1")) ?? EMPTY_TREE, headSha: head };
  }

  const base = await requireRef(dir, source.base);
  const head = await requireRef(dir, source.head);

  if (source.mode === DiffMode.Commits) {
    return { baseSha: base, headSha: head };
  }

  const fork = await mergeBase(dir, base, head);
  if (!fork) {
    throw new InputError("Branches share no history");
  }

  return { baseSha: fork, headSha: head };
}

async function requireRef(dir: string, ref: string | null): Promise<string> {
  // A leading dash would be read as a git option.
  if (!ref || ref.startsWith("-")) {
    throw new InputError(`Invalid ref: ${ref ?? "(empty)"}`);
  }

  const sha = await resolveCommit(dir, ref);
  if (!sha) {
    throw new InputError(`Unknown commit or branch: ${ref}`);
  }

  return sha;
}

// Files a review covers, limited to source.paths when set.
export async function loadChanges(dir: string, source: DiffSource, r: Resolved): Promise<ParsedFile[]> {
  if (source.mode === DiffMode.Files) {
    const picked = (await repoFiles(dir)).filter((f) => inScope(f, source.paths ?? []));
    return addedFiles(dir, picked);
  }

  const files = await loadDiff(dir, r);
  return source.paths ? files.filter((f) => inScope(f.path, source.paths ?? [])) : files;
}

// Files a commit range changes, for picking what its review covers.
// e.g. last_commit → [{ path: "src/a.ts", change: "modified" }]
export async function rangeFiles(dir: string, source: DiffSource): Promise<ChangedFile[]> {
  const r = await resolveSource(dir, source);
  if (!r.headSha) {
    throw new InputError("Not a commit range");
  }

  return changedBetween(dir, r.baseSha, r.headSha);
}

// Tracked and untracked files, ignored ones left out.
export async function repoFiles(dir: string): Promise<string[]> {
  const [tracked, untracked] = await Promise.all([trackedFiles(dir), untrackedFiles(dir)]);
  return [...new Set([...tracked, ...untracked])].sort();
}

// "src/a.ts" is in scope of "src/a.ts" and of folder "src", not of "sr".
function inScope(file: string, paths: string[]): boolean {
  return paths.some((p) => file === p || file.startsWith(`${p.replace(/\/+$/, "")}/`));
}

export function pastedFiles(files: PastedFile[]): ParsedFile[] {
  return files.map((f) => addedFilePatch(f.name, f.text));
}

// Changed files between the resolved points. Working tree diffs include
// untracked files, which plain `git diff` leaves out.
export async function loadDiff(dir: string, r: Resolved): Promise<ParsedFile[]> {
  const files = parseDiff(await diff(dir, r.baseSha, r.headSha));
  if (r.headSha) {
    return files;
  }

  files.push(...(await addedFiles(dir, await untrackedFiles(dir))));
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

// Working tree files as whole-file additions. Missing files are left out.
async function addedFiles(dir: string, files: string[]): Promise<ParsedFile[]> {
  const parsed: ParsedFile[] = [];
  for (const file of files) {
    const bytes = await readBytes(path.join(dir, file));
    if (!bytes) {
      continue;
    }

    if (isBinary(bytes)) {
      parsed.push({ ...addedFilePatch(file, ""), binary: true });
      continue;
    }

    parsed.push(addedFilePatch(file, bytes.toString("utf8")));
  }

  return parsed;
}

// File content on the "new" side: working tree or the head commit.
export async function headContent(dir: string, headSha: string | null, file: string): Promise<string | null> {
  if (headSha) {
    return showFile(dir, headSha, file);
  }

  const bytes = await readBytes(path.join(dir, file));
  return bytes ? bytes.toString("utf8") : null;
}

function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, BINARY_SNIFF_BYTES).includes(NUL);
}
