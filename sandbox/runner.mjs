#!/usr/bin/env node
// Sandbox runner: executes code jobs the app drops into SANDBOX_DIR.
//
//   app ── <id>.job.json ──► runner ──► <id>.result.json ──► app
//   runner ── runner.json heartbeat (every 2 s, lists usable languages)
//
// Isolation comes from its container: no network, repos read-only, memory
// and process limits, read-only root fs. As root on Linux it runs each job
// as `nobody`. Started outside Docker (dev), code runs as you: no isolation.
//
// Usage: SANDBOX_DIR=… REPO_ROOT=… node sandbox/runner.mjs
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = process.env.SANDBOX_DIR;
const REPO_ROOT = process.env.REPO_ROOT ? path.resolve(process.env.REPO_ROOT) : null;
const PYTHON = process.env.SANDBOX_PYTHON ?? "python3";

const HEARTBEAT_MS = 2000;
const POLL_MS = 150;
const MAX_PARALLEL = 2;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const NOBODY = 65534;
const JOB_ID = /^[0-9a-f-]{36}$/;
const JOB_SUFFIX = ".job.json";

// Interpreter per language. Java runs a single source file (JEP 330), heap
// capped to stay inside the container's memory limit.
const LANGUAGES = {
  python: { file: "main.py", cmd: [PYTHON, "main.py"], probe: [PYTHON, "--version"] },
  javascript: { file: "main.mjs", cmd: ["node", "main.mjs"], probe: ["node", "--version"] },
  typescript: { file: "main.ts", cmd: ["node", "main.ts"], probe: ["node", "--version"] },
  java: { file: "Main.java", cmd: ["java", "-Xmx256m", "-XX:+UseSerialGC", "Main.java"], probe: ["java", "-version"] },
};

if (!DIR) {
  console.error("SANDBOX_DIR is required");
  process.exit(1);
}

const isRoot = process.getuid?.() === 0;
const isolated = isRoot && process.platform === "linux";
if (!isolated) {
  console.warn("WARNING: not root on Linux. Jobs run as the current user, without isolation.");
}

const available = Object.entries(LANGUAGES)
  .filter(([, l]) => spawnSync(l.probe[0], l.probe.slice(1), { stdio: "ignore" }).status === 0)
  .map(([name]) => name);

let active = 0;

// --- heartbeat -------------------------------------------------------------

function heartbeat() {
  writeAtomic(path.join(DIR, "runner.json"), { at: Date.now(), languages: available, isolated });
}

// --- job loop --------------------------------------------------------------

function poll() {
  if (active >= MAX_PARALLEL) {
    return;
  }

  let names;
  try {
    names = fs.readdirSync(DIR).filter((n) => n.endsWith(JOB_SUFFIX));
  } catch {
    return;
  }

  for (const name of names) {
    if (active >= MAX_PARALLEL) {
      return;
    }

    const id = name.slice(0, -JOB_SUFFIX.length);
    if (!JOB_ID.test(id)) {
      continue;
    }

    // Claim by rename: the app never sees a half-processed job twice.
    const running = path.join(DIR, `${id}.running`);
    try {
      fs.renameSync(path.join(DIR, name), running);
    } catch {
      continue;
    }

    active++;
    handle(id, running).finally(() => active--);
  }
}

async function handle(id, running) {
  let result;
  try {
    const job = JSON.parse(fs.readFileSync(running, "utf8"));
    result = await execute(job);
  } catch (e) {
    result = failure(`Bad job: ${e.message}`);
  }

  writeAtomic(path.join(DIR, `${id}.result.json`), result);
  fs.rmSync(running, { force: true });
}

// --- execution -------------------------------------------------------------

function execute(job) {
  const lang = LANGUAGES[job.language];
  if (!lang || !available.includes(job.language)) {
    return Promise.resolve(failure(`Language not available: ${job.language}`));
  }

  if (typeof job.code !== "string") {
    return Promise.resolve(failure("Missing code"));
  }

  const repo = safeRepo(job.repo);
  const timeout = Math.min(Number(job.timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "run-"));
  fs.writeFileSync(path.join(work, lang.file), job.code);

  if (isolated) {
    fs.chownSync(work, NOBODY, NOBODY);
    fs.chownSync(path.join(work, lang.file), NOBODY, NOBODY);
  }

  const [cmd, ...args] = isolated
    ? ["setpriv", `--reuid=${NOBODY}`, `--regid=${NOBODY}`, "--clear-groups", "--", ...lang.cmd]
    : lang.cmd;

  return new Promise((resolve) => {
    const started = Date.now();
    const out = { stdout: "", stderr: "" };
    let timedOut = false;

    const child = spawn(cmd, args, {
      cwd: work,
      env: jobEnv(work, repo),
      // Own process group, so a timeout kills everything it spawned.
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const capture = (key) => (chunk) => {
      if (out[key].length < MAX_OUTPUT_BYTES) {
        out[key] += chunk.toString("utf8").slice(0, MAX_OUTPUT_BYTES - out[key].length);
      }
    };
    child.stdout.on("data", capture("stdout"));
    child.stderr.on("data", capture("stderr"));

    const timer = setTimeout(() => {
      timedOut = true;
      kill(child);
    }, timeout);

    const finish = (exitCode, error) => {
      clearTimeout(timer);
      fs.rmSync(work, { recursive: true, force: true });
      resolve({ exitCode, ...out, durationMs: Date.now() - started, timedOut, error });
    };

    child.on("error", (e) => finish(null, e.message));
    child.on("close", (code) => finish(code, null));
  });
}

function jobEnv(work, repo) {
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: work,
    TMPDIR: work,
    LANG: "C.UTF-8",
    REPO: repo ?? "",
    // Project modules importable; the repo is read-only, so no bytecode.
    PYTHONPATH: repo ?? "",
    PYTHONDONTWRITEBYTECODE: "1",
    NODE_PATH: repo ? path.join(repo, "node_modules") : "",
  };
}

// The job's repo, only if it sits inside REPO_ROOT.
function safeRepo(repo) {
  if (typeof repo !== "string" || !REPO_ROOT) {
    return null;
  }

  const abs = path.resolve(repo);
  const rel = path.relative(REPO_ROOT, abs);
  return rel.split(path.sep)[0] === ".." || path.isAbsolute(rel) ? null : abs;
}

function kill(child) {
  try {
    if (process.platform === "win32") {
      child.kill("SIGKILL");
      return;
    }

    process.kill(-child.pid, "SIGKILL");
  } catch {
    // Already exited.
  }
}

function failure(error) {
  return { exitCode: null, stdout: "", stderr: "", durationMs: 0, timedOut: false, error };
}

function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

// --- start -----------------------------------------------------------------

fs.mkdirSync(DIR, { recursive: true });
heartbeat();
setInterval(heartbeat, HEARTBEAT_MS);
setInterval(poll, POLL_MS);
console.log(`Sandbox runner on ${DIR}. Languages: ${available.join(", ") || "none"}.`);
