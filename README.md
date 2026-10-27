# PR Review

Rule-based LLM code review for local git repos. Point it at a repo, pick what to review (uncommitted changes, last commit, two commits, two branches), and get a report with findings tagged by your rule categories, inline in the diff, with one-click fixes.

## Features

- **Any LLM**: OpenAI, Anthropic, or any OpenAI-compatible server (vLLM, LiteLLM, Ollama, LM Studio). Configured in Settings.
- **Rules**: categories with a color, file globs and a pasted rule list. Global rules, overridden or extended per project.
- **Built-in packs**: Bugs (always its own pass, findings need a concrete failure scenario) and language packs (Python, JavaScript, TypeScript, Java, Rust, HTML, CSS). Packs apply only to matching files, so multi-language repos get the right rules per file.
- **Large reviews**: one overview call, then one call per file chunk and rule pass, sized to the model's context window. Long rule lists are split into per-category passes.
- **Report**: findings inline in the diff, filters, apply fix, dismiss with reason, refresh after local edits, re-review only changed files, retry failed parts, Markdown export, exact prompt preview, token and cost totals.
- **Chat** about a review; the model can read files, grep and see git history.
- **Learning**: turn dismissed findings into proposed rule changes you accept or reject.
- **Code sandbox** (off by default, Settings): the chat agent can run Python, JavaScript, TypeScript and Java to check a behavior, e.g. reproduce a suspected bug.

## Sandbox isolation

The `sandbox` compose service runs LLM-written code. It has no network (it talks to the app only through a shared job folder), a read-only root filesystem, your repos mounted read-only, no Linux capabilities beyond switching to `nobody`, and limits of 768 MB, 1 CPU and 256 processes. Each job runs as `nobody` in a temp folder with a timeout. Outside Docker (`node sandbox/runner.mjs`) none of this applies.

## Run with npx

On Windows, macOS or Linux, with [Node.js](https://nodejs.org) 22+ and git:

```bash
npx @lucasgenoud/code-review
```

It serves on http://localhost:3000 (or the next free port) and opens your browser. Repos come from your home folder (`--repos <dir>` to change), data lives in your OS's app data folder (`--data <dir>`). `--help` lists the options. The code sandbox is off: outside Docker it has no isolation.

CI publishes the package to npm on `v*` tags, after starting it on all three OSes (`scripts/npm/`). It needs an npm automation token in the `NPM_TOKEN` repository secret. To build and test it locally:

```bash
npm run build && node scripts/npm/pack.mjs 0.0.0-local
cd dist/npm && npm pack --pack-destination .. && cd ../..
node scripts/npm/smoke.mjs dist/lucasgenoud-code-review-0.0.0-local.tgz
```

## Run with Docker

Prebuilt images (published by CI from `main` to GitHub Container Registry):

```bash
docker compose pull && docker compose up -d
```

Or build from source:

```bash
docker compose up -d --build
```

Open http://localhost:3001. Repos come from the folder containing this project (`..`). Data lives in the `data` Docker volume: a host folder would break SQLite on Windows.

From the container, an LLM server on your machine is at `http://host.docker.internal:<port>/v1`.

No authentication: don't expose the port beyond your machine.

## Develop

```bash
cp .env.example .env.local   # set REPO_ROOT
npm install
npm run dev
```

No API key? Run the mock LLM and add it in Settings as an OpenAI-compatible provider, base URL `http://localhost:4010/v1`, model `mock-reviewer`:

```bash
node scripts/mock-llm.mjs 4010
```

- `npm test`: unit tests and an end-to-end pipeline test against the mock LLM
- `sh scripts/docker-smoke.sh`: build the images, check the app serves with fresh volumes and the sandbox isolation holds
- `npm run db:generate`: create a migration after editing `src/server/drivers/schema.ts`. Migrations run on startup.

See [AGENTS.md](AGENTS.md) for architecture and code rules.
