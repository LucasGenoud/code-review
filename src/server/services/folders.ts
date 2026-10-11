import path from "node:path";
import { subDirs } from "@/server/drivers/fs";
import { isRoot, resolveInRoot } from "./paths";

export type Folder = { name: string; path: string; isRepo: boolean };
export type Listing = { path: string; parent: string | null; folders: Folder[] };

// Server-side folder browser for picking projects. Browsers can't hand the
// server a real path, so browsing happens here, confined to REPO_ROOT.
export async function browse(dir?: string): Promise<Listing> {
  const target = await resolveInRoot(dir);
  const entries = await subDirs(target);

  const folders = entries
    .map((e) => ({ ...e, path: path.join(target, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const parent = (await isRoot(target)) ? null : path.dirname(target);
  return { path: target, parent, folders };
}
