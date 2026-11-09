import path from "node:path";
import { config } from "@/server/config";
import { realDir } from "@/server/drivers/fs";
import { InputError } from "./errors";

const PARENT = "..";

// True when `target` is `root` or below it. Both must be absolute.
// e.g. isInside("/repos", "/repos/app") → true, isInside("/repos", "/etc") → false
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  if (path.isAbsolute(rel)) {
    return false;
  }

  return rel.split(path.sep)[0] !== PARENT;
}

// Real path of `dir` (default: REPO_ROOT). Rejects anything outside REPO_ROOT,
// including symlinks pointing out of it.
export async function resolveInRoot(dir?: string): Promise<string> {
  const root = await realDir(config.repoRoot);
  const target = await realDir(dir ?? root).catch(() => {
    throw new InputError(`Folder not found: ${dir}`);
  });

  if (!isInside(root, target)) {
    throw new InputError("Folder is outside REPO_ROOT");
  }

  return target;
}

export async function isRoot(dir: string): Promise<boolean> {
  return dir === (await realDir(config.repoRoot));
}

// Tests, fixtures and test data, by the usual layouts:
//   src/test/java/…, __tests__/, fixtures/, testdata/
//   pay.test.ts, pay_spec.rb, pay_test.go, PayServiceTest.java, PayIT.java
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|fixtures?|test-?data)\/|[._-](test|spec)\.[^/]+$|_test\.[^/]+$|[A-Za-z](Tests?|IT)\.[^/]+$/;

export function isTestPath(file: string): boolean {
  return TEST_PATH.test(file);
}
