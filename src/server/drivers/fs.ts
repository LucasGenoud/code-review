import fs from "node:fs/promises";
import path from "node:path";

const GIT_DIR = ".git";
const HIDDEN_PREFIX = ".";

export type DirEntry = { name: string; isRepo: boolean };

// Resolves symlinks and `..`. Throws if the path does not exist.
export async function realDir(dir: string): Promise<string> {
  return fs.realpath(dir);
}

// Visible subdirectories of `dir`, flagging git repos (a `.git` dir or file).
export async function subDirs(dir: string): Promise<DirEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const dirs = entries.filter(
    (e) => e.isDirectory() && !e.name.startsWith(HIDDEN_PREFIX),
  );

  return Promise.all(
    dirs.map(async (e) => ({
      name: e.name,
      isRepo: await exists(path.join(dir, e.name, GIT_DIR)),
    })),
  );
}

// File as bytes, or null if missing.
export async function readBytes(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

export async function writeText(file: string, content: string): Promise<void> {
  await fs.writeFile(file, content, "utf8");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
