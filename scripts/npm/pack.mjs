#!/usr/bin/env node
// Assembles the npm package from a `next build` (standalone output):
//
//   dist/npm/
//     package.json          @lucasgenoud/code-review, bin: code-review
//     bin/code-review.mjs   launcher (scripts/npm/code-review.mjs)
//     app/                  .next/standalone + static assets + migrations
//       node_modules/better-sqlite3/prebuilds/   binaries for every OS
//
// Usage: node scripts/npm/pack.mjs <version>   e.g. v1.2.0 or 0.0.0-dev
import fs from "node:fs";
import path from "node:path";

const NAME = "@lucasgenoud/code-review";
const BIN = "code-review";
const OUT = path.resolve("dist/npm");
const APP = path.join(OUT, "app");
const STANDALONE = path.resolve(".next/standalone");
const MIN_NODE = ">=22";
const LICENSE = "Apache-2.0";
// better-sqlite3 files needed at runtime. The build traces only the
// binary of the machine it ran on; prebuilds/ covers Windows, macOS and
// Linux (x64, arm64) for any Node version (Node-API).
const SQLITE_RUNTIME = ["package.json", "LICENSE", "lib", "prebuilds"];
const SQLITE = "node_modules/better-sqlite3";
// Copied by the build's file tracing but never read at runtime; the first
// ones could hold local secrets, history or data.
//   src: compiled into .next · sharp: next/image only, unused, and built
//   for the build machine's OS only
const EXCLUDED = [".env", ".env.local", "data", ".git", "src", "node_modules/sharp", "node_modules/@img"];

const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!version) {
  console.error("Usage: node scripts/npm/pack.mjs <version>");
  process.exit(1);
}

if (!fs.existsSync(path.join(STANDALONE, "server.js"))) {
  console.error("No standalone build: run `npm run build` first.");
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });

// The server and its traced dependencies, then what `next build` leaves out.
fs.cpSync(STANDALONE, APP, { recursive: true, dereference: true });
fs.cpSync(".next/static", path.join(APP, ".next/static"), { recursive: true });
fs.cpSync("public", path.join(APP, "public"), { recursive: true });
fs.cpSync("drizzle", path.join(APP, "drizzle"), { recursive: true });
for (const name of EXCLUDED) {
  fs.rmSync(path.join(APP, name), { recursive: true, force: true });
}

// Native SQLite for every OS, not only the build machine's.
fs.rmSync(path.join(APP, SQLITE), { recursive: true, force: true });
for (const entry of SQLITE_RUNTIME) {
  fs.cpSync(path.join(SQLITE, entry), path.join(APP, SQLITE, entry), { recursive: true });
}

// Turbopack loads externals through hashed aliases, symlinks like
// .next/node_modules/better-sqlite3-90e2… → node_modules/better-sqlite3.
// npm drops symlinks: replace each with a stub package re-exporting the
// real one, found by the normal lookup in app/node_modules.
const ALIASES = path.join(APP, ".next/node_modules");
for (const alias of fs.existsSync(ALIASES) ? fs.readdirSync(ALIASES) : []) {
  const link = path.join(ALIASES, alias);
  if (!fs.lstatSync(link).isSymbolicLink()) {
    continue;
  }

  const pkg = fs.readlinkSync(link).split("node_modules/").pop();
  fs.rmSync(link);
  fs.mkdirSync(link);
  fs.writeFileSync(path.join(link, "package.json"), `${JSON.stringify({ name: alias, main: "index.js" })}\n`);
  fs.writeFileSync(path.join(link, "index.js"), `module.exports = require(${JSON.stringify(pkg)});\n`);
}

fs.mkdirSync(path.join(OUT, "bin"));
fs.copyFileSync("scripts/npm/code-review.mjs", path.join(OUT, "bin", `${BIN}.mjs`));
fs.copyFileSync("scripts/npm/README.md", path.join(OUT, "README.md"));
fs.copyFileSync("LICENSE", path.join(OUT, "LICENSE"));

const manifest = {
  name: NAME,
  version,
  description: "Review git diffs of local projects against your rules, with any LLM API.",
  license: LICENSE,
  repository: { type: "git", url: "git+https://github.com/LucasGenoud/code-review.git" },
  bin: { [BIN]: `bin/${BIN}.mjs` },
  files: ["bin", "app"],
  engines: { node: MIN_NODE },
};
fs.writeFileSync(path.join(OUT, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Assembled ${NAME}@${version} in ${path.relative(process.cwd(), OUT)}`);
