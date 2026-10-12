#!/usr/bin/env node
// Builds the eval bench: a git repo whose `main` is eval/bench/base, plus one
// branch per case in eval/bench/cases. A case edits base files and may add
// files. Planted issues end their line(s) with a «id» marker; the build strips
// markers and records where each issue landed, so the answer key never drifts
// from the code.
//
//   base ──► main ──┬─► case/01-refunds        (issues: refund-sign, …)
//                   ├─► case/02-discount-codes
//                   └─► …
//
// Usage: node eval/build.mjs <dir>   (builds the repo, prints the key)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.join(HERE, "bench", "base");
const CASES = path.join(HERE, "bench", "cases");
const MAIN = "main";
const CASE_PREFIX = "case/";
const MARKER = /\s*«([\w-]+)»$/;

function git(dir, ...args) {
  return execFileSync("git", ["-c", "user.name=bench", "-c", "user.email=bench@example.com", ...args], {
    cwd: dir,
    encoding: "utf8",
  });
}

// Replaces `find`, which must occur exactly once, so edits never land twice.
function applyEdit(dir, edit) {
  const file = path.join(dir, edit.file);
  const text = fs.readFileSync(file, "utf8");
  const at = text.indexOf(edit.find);
  if (at < 0 || text.indexOf(edit.find, at + 1) >= 0) {
    throw new Error(`${edit.file}: find must match exactly once: ${edit.find.slice(0, 80)}`);
  }

  fs.writeFileSync(file, text.slice(0, at) + edit.replace + text.slice(at + edit.find.length));
}

// Strips markers from a file. Returns id → line ranges in that file; marked
// lines next to each other form one range.
// e.g. "    x = 1  «bug-a»" on line 7 → { "bug-a": [{ start: 7, end: 7 }] }
function stripMarkers(file) {
  const ranges = new Map();
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const m = MARKER.exec(line);
    if (!m) {
      return;
    }

    lines[i] = line.slice(0, m.index);
    const list = ranges.get(m[1]) ?? [];
    const last = list.at(-1);
    if (last && last.end === i) {
      last.end = i + 1;
    } else {
      list.push({ start: i + 1, end: i + 1 });
    }
    ranges.set(m[1], list);
  });

  fs.writeFileSync(file, lines.join("\n"));
  return ranges;
}

// Applies a case to the work tree. Returns its issues with their locations.
function applyCase(dir, name, spec) {
  const touched = new Set();
  for (const edit of spec.edits ?? []) {
    applyEdit(dir, edit);
    touched.add(edit.file);
  }

  for (const [rel, content] of Object.entries(spec.files ?? {})) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
    touched.add(rel);
  }

  // An issue may sit in several files, e.g. a caller and its callee.
  const locations = new Map();
  for (const rel of touched) {
    for (const [id, ranges] of stripMarkers(path.join(dir, rel))) {
      const here = ranges.map((r) => ({ path: rel, ...r }));
      locations.set(id, [...(locations.get(id) ?? []), ...here]);
    }
  }

  const declared = Object.keys(spec.issues ?? {});
  const unmarked = declared.filter((id) => !locations.has(id));
  const undeclared = [...locations.keys()].filter((id) => !declared.includes(id));
  if (unmarked.length > 0 || undeclared.length > 0) {
    throw new Error(`${name}: unmarked issues [${unmarked}], undeclared markers [${undeclared}]`);
  }

  return declared.map((id) => ({ id, ...spec.issues[id], locations: locations.get(id) }));
}

function hasJavac() {
  try {
    execFileSync("javac", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Planted issues must be the only defects: a compile error would be a real
// finding missing from the key. Optional, so machines without a JDK can build.
function assertCompiles(dir, name) {
  const sources = fs
    .readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith(".java"))
    .map((f) => path.join(dir, f));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "bench-javac-"));
  try {
    execFileSync("javac", ["-nowarn", "-d", out, ...sources], { stdio: "pipe" });
  } catch (e) {
    throw new Error(`${name} does not compile:\n${e.stderr}`);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

// Builds the bench repo in `dir` (wiped first). Returns the answer key.
export async function buildBench(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(BASE, dir, { recursive: true });
  git(dir, "init", "-q", "-b", MAIN);
  // Exact bytes: the key's line numbers must match what the reviewer sees.
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "Initial ledger service");

  const javac = hasJavac();
  if (javac) {
    assertCompiles(dir, MAIN);
  }

  const cases = [];
  const files = fs.readdirSync(CASES).filter((f) => f.endsWith(".mjs")).sort();
  for (const file of files) {
    const name = file.replace(/\.mjs$/, "");
    const spec = (await import(pathToFileURL(path.join(CASES, file)).href)).default;
    const branch = CASE_PREFIX + name;

    git(dir, "checkout", "-q", "-b", branch, MAIN);
    const issues = applyCase(dir, name, spec);
    if (javac) {
      assertCompiles(dir, name);
    }

    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", spec.title);
    git(dir, "checkout", "-q", MAIN);

    cases.push({ name, base: MAIN, head: branch, title: spec.title, issues });
  }

  return cases;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: node eval/build.mjs <dir>");
    process.exit(1);
  }

  console.log(JSON.stringify(await buildBench(path.resolve(dir)), null, 2));
}
