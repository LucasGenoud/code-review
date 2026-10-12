import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { DiffMode, UnitStatus } from "@/lib/domain";
import { buildBench } from "./build.mjs";
import { type BenchCase, matchFindings, summarize, type Tally } from "./score";

// Reviews every bench case with the real engine and scores the findings
// against the answer key. Skipped unless EVAL=1. PowerShell:
//   $env:EVAL=1; npm run eval
// Options (env):
//   EVAL_MODEL=<name>      model to use; default: the app's default model
//   EVAL_CASES=03,21       only cases whose name starts with these
//   EVAL_LABEL=baseline    names the result file
//   EVAL_PARALLEL=2        reviews running at once
//
// Works on a copy of ./data (providers, keys, rules), so the dev database is
// untouched. Writes eval/results/<time>-<label>.json.

const DEV_DATA = path.resolve("data");
const DB_FILE = "app.db";
const SECRET_FILE = "secret.key";
const RESULTS = path.resolve("eval", "results");
const POLL_MS = 1000;
const TIMEOUT_MS = 4 * 60 * 60 * 1000;
const DEFAULT_PARALLEL = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (t: Tally) => `${t.hit}/${t.total} (${t.total ? Math.round((100 * t.hit) / t.total) : 0}%)`;

// Online backup: safe while the dev server holds the database open.
async function copyDevData(dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  const source = new Database(path.join(DEV_DATA, DB_FILE), { readonly: true });
  await source.backup(path.join(dest, DB_FILE));
  source.close();
  fs.copyFileSync(path.join(DEV_DATA, SECRET_FILE), path.join(dest, SECRET_FILE));
}

function appVersion(): string {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "";
  return dirty ? `${sha}+dirty` : sha;
}

describe.skipIf(!process.env.EVAL)("review eval", () => {
  it("scores the bench", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prr-eval-"));
    await copyDevData(path.join(tmp, "data"));
    process.env.DATA_DIR = path.join(tmp, "data");
    process.env.REPO_ROOT = tmp;

    const repo = path.join(tmp, "ledger");
    const only = process.env.EVAL_CASES?.split(",");
    const cases = ((await buildBench(repo)) as BenchCase[]).filter((c) => !only || only.some((p) => c.name.startsWith(p)));

    const providers = await import("@/server/services/providers");
    const settings = await import("@/server/services/settings");
    const projects = await import("@/server/services/projects");
    const engine = await import("@/server/services/review/engine");
    const reviews = await import("@/server/services/reviews");
    const { limiter } = await import("@/server/services/review/limiter");

    // Model: by name, else the app default.
    const models = providers.listProviders().flatMap((p) => p.models);
    const wanted = process.env.EVAL_MODEL;
    const model = wanted ? models.find((m) => m.name === wanted) : models.find((m) => m.id === settings.getSettings().defaultModelId);
    if (!model) {
      throw new Error(wanted ? `No model named ${wanted}` : "No default model: set one in the app or pass EVAL_MODEL");
    }

    // Fixed description from the bench README, so runs differ only by what we change.
    const project = await projects.addProject(repo);
    while (projects.isDescribing(project.id)) {
      await sleep(POLL_MS);
    }
    const description = fs.readFileSync(path.join(repo, "README.md"), "utf8");
    projects.saveProjectSettings(project.id, { description, ignoreGlobs: "", modelId: model.id });

    const startedAt = new Date();
    const limit = limiter(Number(process.env.EVAL_PARALLEL ?? DEFAULT_PARALLEL));
    const results = await Promise.all(
      cases.map((c) =>
        limit(async () => {
          const t0 = Date.now();
          const id = await engine.startReview(project.id, { mode: DiffMode.Branches, base: c.base, head: c.head }, null);
          while (engine.isRunning(id)) {
            await sleep(POLL_MS);
          }

          const report = reviews.getReport(id);
          const match = matchFindings(c.issues, report.findings);
          const line = `${c.name.padEnd(28)} ${match.hits.size}/${c.issues.length} found, ${report.findings.length} findings, ${match.unmatched.length} unmatched`;
          console.log(line);
          return { c, report, match, seconds: Math.round((Date.now() - t0) / 1000) };
        }),
      ),
    );

    const summary = summarize(results.map((r) => ({ issues: r.c.issues, match: r.match, findings: r.report.findings.length })));
    const cost = results.reduce((s, r) => s + (r.report.review.cost ?? 0), 0);
    const failedUnits = results.reduce((s, r) => s + r.report.units.filter((u) => u.status !== UnitStatus.Done).length, 0);
    const matched = summary.findings - summary.unmatched;

    console.log(`\nModel ${model.name}, ${cases.length} cases`);
    console.log(`Recall      ${pct(summary.issues)}`);
    for (const [group, t] of Object.entries(summary.groups).sort()) {
      console.log(`  ${group.padEnd(18)} ${pct(t)}`);
    }
    console.log(`Precision   ${pct({ hit: matched, total: summary.findings })}  (${summary.duplicates} duplicates)`);
    console.log(`Clean cases ${summary.cleanFindings} findings`);
    console.log(`Failed units ${failedUnits}, cost $${cost.toFixed(4)}`);

    // Full detail for reading misses and unmatched findings.
    const label = process.env.EVAL_LABEL ?? "run";
    const file = path.join(RESULTS, `${startedAt.toISOString().replace(/[:.]/g, "-")}-${label}.json`);
    fs.mkdirSync(RESULTS, { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          label,
          model: model.name,
          app: appVersion(),
          startedAt,
          summary,
          cost,
          failedUnits,
          cases: results.map(({ c, report, match, seconds }) => ({
            name: c.name,
            title: c.title,
            status: report.review.status,
            error: report.review.error,
            seconds,
            cost: report.review.cost,
            inputTokens: report.review.inputTokens,
            outputTokens: report.review.outputTokens,
            issues: c.issues.map((i) => {
              const f = match.hits.has(i.id) ? report.findings[match.hits.get(i.id)!] : null;
              return { id: i.id, kind: i.kind, difficulty: i.difficulty, note: i.note, found: f && { line: f.startLine, title: f.title } };
            }),
            extra: [...match.duplicates.map((i) => ["duplicate", i] as const), ...match.unmatched.map((i) => ["unmatched", i] as const)].map(
              ([type, i]) => {
                const f = report.findings[i];
                return { type, path: f.path, line: f.startLine, severity: f.severity, title: f.title, explanation: f.explanation };
              },
            ),
          })),
        },
        null,
        2,
      ),
    );
    console.log(`\n${file}`);

    expect(results).toHaveLength(cases.length);
  }, TIMEOUT_MS);
});
