import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Client side of the sandbox runner's file protocol (see sandbox/runner.mjs):
//   write <id>.job.json ─► wait for <id>.result.json ─► read + delete

export type RunRequest = { language: string; code: string; repo: string | null; timeoutMs: number };

export type RunResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  error: string | null;
};

export type RunnerInfo = { at: number; languages: string[]; isolated: boolean };

const POLL_MS = 100;
// Room for queueing behind other jobs and process start-up.
const GRACE_MS = 15_000;
const OWNER_ONLY = 0o600;
const HEARTBEAT_FILE = "runner.json";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Last heartbeat of the runner, or null if it never ran.
export async function runnerInfo(dir: string): Promise<RunnerInfo | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, HEARTBEAT_FILE), "utf8"));
  } catch {
    return null;
  }
}

// Submits a job and waits for its result. Null = runner didn't answer.
export async function runJob(dir: string, req: RunRequest): Promise<RunResult | null> {
  const id = crypto.randomUUID();
  const job = path.join(dir, `${id}.job.json`);
  const result = path.join(dir, `${id}.result.json`);

  // Write then rename: the runner only picks complete files.
  await fs.writeFile(`${job}.tmp`, JSON.stringify(req), { mode: OWNER_ONLY });
  await fs.rename(`${job}.tmp`, job);

  const deadline = Date.now() + req.timeoutMs + GRACE_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);

    try {
      const data = JSON.parse(await fs.readFile(result, "utf8")) as RunResult;
      await fs.rm(result, { force: true });
      return data;
    } catch {
      // Not there yet.
    }
  }

  // Never picked up: withdraw it so it doesn't run later.
  await fs.rm(job, { force: true });
  return null;
}
