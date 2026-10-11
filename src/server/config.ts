import path from "node:path";

// Env-driven settings. Docker sets both; dev reads them from .env.local.
const DEFAULT_DATA_DIR = "./data";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var ${name}. See .env.example.`);
  }

  return value;
}

export const config = {
  get repoRoot() {
    return path.resolve(/*turbopackIgnore: true*/ required("REPO_ROOT"));
  },
  get dataDir() {
    return path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR ?? DEFAULT_DATA_DIR);
  },
  // Job folder shared with the sandbox runner. Unset = no sandbox.
  get sandboxDir(): string | null {
    const dir = process.env.SANDBOX_DIR;
    return dir ? path.resolve(/*turbopackIgnore: true*/ dir) : null;
  },
};
