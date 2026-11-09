import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// What every eval runs on: a copy of the dev database (providers, keys,
// rules), so evals never touch ./data, and the app version they measured.
// EVAL_DATA=<dir> copies another data folder, e.g. one set up with the mock LLM.

const DEV_DATA = path.resolve(process.env.EVAL_DATA ?? "data");
const DB_FILE = "app.db";
const SECRET_FILE = "secret.key";

// Online backup: safe while the dev server holds the database open. The
// copy caps every model's concurrency, which the engine shares across reviews.
export async function copyDevData(dest: string, concurrency: number) {
  fs.mkdirSync(dest, { recursive: true });
  const source = new Database(path.join(DEV_DATA, DB_FILE), { readonly: true });
  await source.backup(path.join(dest, DB_FILE));
  source.close();
  // Created with the first stored API key; absent with keyless local servers.
  if (fs.existsSync(path.join(DEV_DATA, SECRET_FILE))) {
    fs.copyFileSync(path.join(DEV_DATA, SECRET_FILE), path.join(dest, SECRET_FILE));
  }

  const copy = new Database(path.join(dest, DB_FILE));
  copy.prepare("UPDATE models SET max_concurrency = ?").run(concurrency);
  copy.close();
}

export function appVersion(): string {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";
  return dirty ? `${sha}+dirty` : sha;
}
