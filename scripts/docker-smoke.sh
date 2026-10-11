#!/bin/sh
# Smoke test: starts docker-compose.yml under a throwaway project name
# (own volumes, own port) and checks:
#   1. the project list renders (body, not status: DB errors inside
#      Suspense still return 200)
#   2. the sandbox runs Python and Java, with no network, read-only repos,
#      code as `nobody`, and no access to the job folder
# Usage: sh scripts/docker-smoke.sh
set -eu

PROJECT=prr-smoke
NAME=prr-smoke
PORT=3099
EMPTY_STATE="No projects yet"
STARTUP_SECONDS=4

compose() {
  docker compose -p "$PROJECT" "$@"
}

compose build -q

# `run` skips the compose port mapping, so it can run beside the real app.
# It also starts the sandbox service (depends_on).
compose run -d --rm --name "$NAME" -p "127.0.0.1:$PORT:3000" app >/dev/null
trap 'docker stop "$NAME" >/dev/null; compose down -v >/dev/null 2>&1' EXIT
sleep "$STARTUP_SECONDS"

if ! curl -s "http://localhost:$PORT" | grep -q "$EMPTY_STATE"; then
  echo "FAIL: project list did not render"
  docker logs "$NAME" 2>&1 | grep -m1 -E "code:|Error" || true
  exit 1
fi

echo "PASS: app"

# Talks to the runner through the job folder, like the app does.
docker exec -i "$NAME" node - <<'EOF'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dir = process.env.SANDBOX_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(language, code) {
  const id = crypto.randomUUID();
  const job = path.join(dir, `${id}.job.json`);
  fs.writeFileSync(`${job}.tmp`, JSON.stringify({ language, code, repo: "/repos", timeoutMs: 20000 }));
  fs.renameSync(`${job}.tmp`, job);

  const result = path.join(dir, `${id}.result.json`);
  for (let i = 0; i < 400; i++) {
    await sleep(100);
    if (fs.existsSync(result)) {
      return JSON.parse(fs.readFileSync(result, "utf8"));
    }
  }

  throw new Error(`no result for ${language}`);
}

const checks = [
  ["runs python", "python", "print(6 * 7)", (r) => r.stdout.trim() === "42"],
  ["runs java", "java", "class Main { public static void main(String[] a) { System.out.println(6 * 7); } }", (r) => r.stdout.trim() === "42"],
  ["no network", "python", "import urllib.request\nurllib.request.urlopen('http://example.com', timeout=3)", (r) => r.exitCode !== 0],
  ["repos read-only", "python", "import os\nopen(os.environ['REPO'] + '/sandbox-write-test', 'w')", (r) => r.exitCode !== 0],
  ["runs as nobody", "python", "import os\nprint(os.getuid())", (r) => r.stdout.trim() === "65534"],
  ["job folder hidden", "python", "import os\nos.listdir('/sandbox')", (r) => r.exitCode !== 0],
];

(async () => {
  while (!fs.existsSync(path.join(dir, "runner.json"))) {
    await sleep(200);
  }

  for (const [name, language, code, ok] of checks) {
    const r = await run(language, code);
    if (!ok(r)) {
      console.log(`FAIL: sandbox ${name}: ${JSON.stringify(r).slice(0, 400)}`);
      process.exit(1);
    }
  }

  console.log("PASS: sandbox");
})();
EOF
