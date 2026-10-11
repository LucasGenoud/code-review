import path from "node:path";
import { z } from "zod";
import { DiffMode } from "@/lib/domain";
import { readBytes } from "@/server/drivers/fs";
import {
  diff,
  EMPTY_TREE,
  mergeBase,
  resolveCommit,
  showFile,
  untrackedFiles,
} from "@/server/drivers/git";
import { addedFilePatch, parseDiff, type ParsedFile } from "./diffParse";
import { InputError } from "./errors";

// What to diff, as the user picked it.
//   uncommitted: HEAD → working tree (incl. untracked)
//   last_commit: HEAD~1 → HEAD
//   commits:     base → head
//   branches:    merge-base(base, head) → head   (like a PR: base...head)
export const sourceSchema = z.object({
  mode: z.enum(DiffMode),
  base: z.string().trim().nullable(),
  head: z.string().trim().nullable(),
});

export type DiffSource = z.infer<typeof sourceSchema>;

// headSha null = working tree.
export type Resolved = { baseSha: string; headSha: string | null };

// Bytes git inspects to decide a file is binary.
const BINARY_SNIFF_BYTES = 8000;
const NUL = 0;

export async function resolveSource(dir: string, source: DiffSource): Promise<Resolved> {
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

// Changed files between the resolved points. Working tree diffs include
// untracked files, which plain `git diff` leaves out.
export async function loadDiff(dir: string, r: Resolved): Promise<ParsedFile[]> {
  const files = parseDiff(await diff(dir, r.baseSha, r.headSha));
  if (r.headSha) {
    return files;
  }

  for (const file of await untrackedFiles(dir)) {
    const bytes = await readBytes(path.join(dir, file));
    if (!bytes) {
      continue;
    }

    if (isBinary(bytes)) {
      files.push({ ...addedFilePatch(file, ""), binary: true });
      continue;
    }

    files.push(addedFilePatch(file, bytes.toString("utf8")));
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
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
