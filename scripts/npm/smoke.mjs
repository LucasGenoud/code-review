#!/usr/bin/env node
// Installs the packed npm tarball in a temp folder, starts it, and checks
// that the home page renders and the database is created where asked. CI
// runs it on Windows, macOS and Linux.
//
// Usage: node scripts/npm/smoke.mjs <path to .tgz>
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 3123;
const URL = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 90_000;
const POLL_MS = 500;
const HTTP_OK = 200;
const NAME = "@lucasgenoud/code-review";

const tarball = path.resolve(process.argv[2] ?? "");
if (!fs.existsSync(tarball)) {
  console.error("Usage: node scripts/npm/smoke.mjs <package.tgz>");
  process.exit(1);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "code-review-smoke-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
execFileSync(npm, ["install", "--prefix", work, "--no-audit", "--no-fund", tarball], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

const launcher = path.join(work, "node_modules", NAME, "bin", "code-review.mjs");
const data = path.join(work, "data");
const app = spawn(process.execPath, [launcher, "--no-open", "--port", String(PORT), "--data", data, "--repos", work], {
  stdio: "inherit",
});

try {
  const home = await waitFor(URL);
  check(home.includes("PR Review"), "home page renders");
  check(fs.existsSync(path.join(data, "app.db")), "database created in --data");
  console.log("Smoke test passed.");
} finally {
  app.kill();
}

async function waitFor(url) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status === HTTP_OK) {
        return await res.text();
      }
    } catch {
      // Not up yet.
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  throw new Error(`${url} didn't answer within ${READY_TIMEOUT_MS / 1000}s`);
}

function check(ok, what) {
  if (!ok) {
    throw new Error(`Smoke test failed: ${what}`);
  }

  console.log(`ok: ${what}`);
}
