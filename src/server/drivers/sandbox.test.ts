import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runJob, runnerInfo } from "./sandbox";

// Runs the real runner script (unisolated outside Docker) against a temp dir.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prr-sandbox-"));
const TIMEOUT_MS = 30_000;
const POLL_MS = 100;
let runner: ChildProcess;

beforeAll(async () => {
  runner = spawn(process.execPath, ["sandbox/runner.mjs"], {
    env: { ...process.env, SANDBOX_DIR: tmp, REPO_ROOT: tmp },
    stdio: "ignore",
  });

  while (!(await runnerInfo(tmp))) {
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}, TIMEOUT_MS);

afterAll(() => {
  runner?.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});

it("reports the languages it can run", async () => {
  expect((await runnerInfo(tmp))?.languages).toContain("javascript");
});

it("runs code and captures output and exit code", async () => {
  const result = await runJob(tmp, {
    language: "javascript",
    code: "console.log(6 * 7); console.error('warn'); process.exit(3);",
    repo: tmp,
    timeoutMs: 5000,
  });

  expect(result).toMatchObject({ exitCode: 3, stdout: "42\n", stderr: "warn\n", timedOut: false, error: null });
}, TIMEOUT_MS);

it("kills code that runs past the timeout", async () => {
  const result = await runJob(tmp, { language: "javascript", code: "while (true) {}", repo: null, timeoutMs: 500 });
  expect(result?.timedOut).toBe(true);
}, TIMEOUT_MS);

it("rejects unknown languages", async () => {
  const result = await runJob(tmp, { language: "cobol", code: "", repo: null, timeoutMs: 500 });
  expect(result?.error).toContain("not available");
}, TIMEOUT_MS);
