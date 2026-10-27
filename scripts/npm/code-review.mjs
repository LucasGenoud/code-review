#!/usr/bin/env node
// `npx @lucasgenoud/code-review`: runs the app without Docker, on Windows,
// macOS or Linux. Starts the bundled Next.js server on localhost with
// per-OS defaults, then opens the browser.
//
//   code-review ──spawn──► node app/server.js   (PORT, DATA_DIR, REPO_ROOT)
//        └── waits for http://localhost:<port> ──► opens the browser
//
// The code sandbox stays off: outside Docker it has no isolation.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const APP_NAME = "code-review";
const DEFAULT_PORT = 3000;
// Ports tried after the default one when it is taken, e.g. 3000…3019.
const PORT_ATTEMPTS = 20;
// The app has no login: only this machine can reach it unless --host says otherwise.
const DEFAULT_HOST = "127.0.0.1";
const MIN_NODE_MAJOR = 22;
const READY_POLL_MS = 300;
const READY_TIMEOUT_MS = 60_000;
const EXIT_USAGE = 2;
const EXIT_FAILURE = 1;

const HELP = `Usage: code-review [options]

Reviews git diffs of local projects with any LLM API, in your browser.

Options:
  --repos <dir>   Folder holding your git repos; projects can only be added
                  from inside it. Default: your home folder.
  --data <dir>    Where settings, reviews and API keys (encrypted) are kept.
                  Default: ${defaultDataDir()}
  --port <n>      Port to listen on. Default: ${DEFAULT_PORT}, or the next free one.
  --host <addr>   Address to listen on. Default: ${DEFAULT_HOST} (this machine only).
  --no-open       Don't open the browser.
  -v, --version   Print the version.
  -h, --help      Print this help.
`;

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..", "app");

main().catch((e) => {
  console.error(`${APP_NAME}: ${e instanceof Error ? e.message : e}`);
  process.exit(EXIT_FAILURE);
});

async function main() {
  const { values } = parseOptions();
  if (values.help) {
    console.log(HELP);
    return;
  }

  if (values.version) {
    console.log(packageVersion());
    return;
  }

  checkRuntime();

  const host = values.host ?? DEFAULT_HOST;
  const port = await choosePort(host, values.port);
  const dataDir = path.resolve(values.data ?? process.env.DATA_DIR ?? defaultDataDir());
  const repoRoot = path.resolve(values.repos ?? process.env.REPO_ROOT ?? os.homedir());
  fs.mkdirSync(dataDir, { recursive: true });

  const server = spawn(process.execPath, [path.join(appDir, "server.js")], {
    cwd: appDir,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), HOSTNAME: host, DATA_DIR: dataDir, REPO_ROOT: repoRoot },
  });
  forwardSignals(server);
  server.on("exit", (code, signal) => process.exit(code ?? (signal ? 0 : EXIT_FAILURE)));

  const url = `http://${host === DEFAULT_HOST ? "localhost" : host}:${port}`;
  await waitUntilReady(url);
  console.log(`\n  PR Review is running at ${url}\n  Repos: ${repoRoot}\n  Data:  ${dataDir}\n  Stop with Ctrl+C.\n`);

  if (!values["no-open"]) {
    openBrowser(url);
  }
}

function parseOptions() {
  try {
    return parseArgs({
      options: {
        repos: { type: "string" },
        data: { type: "string" },
        port: { type: "string" },
        host: { type: "string" },
        "no-open": { type: "boolean" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    console.error(`${APP_NAME}: ${e.message}\n\n${HELP}`);
    process.exit(EXIT_USAGE);
  }
}

// Per-OS app data folder, e.g. ~/Library/Application Support/code-review.
function defaultDataDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_NAME);
  }

  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), APP_NAME);
}

function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8")).version;
}

// Node for the server, git for the repos.
function checkRuntime() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < MIN_NODE_MAJOR) {
    throw new Error(`Node.js ${MIN_NODE_MAJOR} or newer is required (this is ${process.versions.node}).`);
  }

  if (spawnSync("git", ["--version"]).status !== 0) {
    throw new Error("git was not found on the PATH. Install it from https://git-scm.com.");
  }
}

// The asked port, or the first free one from the default.
async function choosePort(host, asked) {
  if (asked !== undefined) {
    const port = Number(asked);
    if (!Number.isInteger(port) || !(await isFree(host, port))) {
      throw new Error(`Port ${asked} is not available.`);
    }

    return port;
  }

  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + PORT_ATTEMPTS; port++) {
    if (await isFree(host, port)) {
      return port;
    }
  }

  throw new Error(`No free port between ${DEFAULT_PORT} and ${DEFAULT_PORT + PORT_ATTEMPTS - 1}; pass --port.`);
}

function isFree(host, port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

async function waitUntilReady(url) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await responds(url)) {
      return;
    }

    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }

  throw new Error(`The server didn't start within ${READY_TIMEOUT_MS / 1000}s.`);
}

function responds(url) {
  return new Promise((resolve) => {
    http
      .get(url, (res) => {
        res.resume();
        resolve(true);
      })
      .on("error", () => resolve(false));
  });
}

// Best effort: the URL is printed anyway.
function openBrowser(url) {
  const [command, args] = browserCommand(url);
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

function browserCommand(url) {
  if (process.platform === "win32") {
    return ["cmd", ["/c", "start", "", url]];
  }

  if (process.platform === "darwin") {
    return ["open", [url]];
  }

  return ["xdg-open", [url]];
}

// Ctrl+C stops the server too.
function forwardSignals(child) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
}
