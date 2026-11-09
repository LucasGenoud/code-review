import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { limiter } from "@/server/services/review/limiter";
import { appVersion, copyDevData } from "../devData";
import { ASK_CASES, PINNED_SHA } from "./cases";
import { scoreAnswer, summarizeAsk } from "./score";

// Asks every case of the codebase chat on this repository at PINNED_SHA,
// with the real retrieval, tools and prompts, and scores the answers.
// Skipped unless EVAL=1:
//   EVAL=1 npm run eval:ask
// Options (env):
//   EVAL_MODEL=<name>    model to use; default: the app's default model
//   EVAL_CASES=03,21     only cases whose name starts with these
//   EVAL_LABEL=baseline  names the result file
//   EVAL_PARALLEL=3      questions running at once
//
// Works on a copy of ./data. Writes eval/results/ask-<time>-<label>.json.

const RESULTS = path.resolve("eval", "results");
const POLL_MS = 500;
const SAVE_TIMEOUT_MS = 10_000;
const TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DEFAULT_PARALLEL = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!process.env.EVAL)("ask eval", () => {
  it("scores the questions", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prr-ask-"));
    const parallel = Number(process.env.EVAL_PARALLEL ?? DEFAULT_PARALLEL);
    await copyDevData(path.join(tmp, "data"), parallel);
    process.env.DATA_DIR = path.join(tmp, "data");
    process.env.REPO_ROOT = tmp;

    // A clone at the pinned commit: answers don't drift with this repo.
    const repo = path.join(tmp, "code-review");
    execFileSync("git", ["clone", "-q", "--shared", path.resolve("."), repo]);
    execFileSync("git", ["-C", repo, "checkout", "-q", PINNED_SHA]);

    const providers = await import("@/server/services/providers");
    const settings = await import("@/server/services/settings");
    const projects = await import("@/server/services/projects");
    const chat = await import("@/server/services/chat");

    const models = providers.listProviders().flatMap((p) => p.models);
    const wanted = process.env.EVAL_MODEL;
    const model = wanted ? models.find((m) => m.name === wanted) : models.find((m) => m.id === settings.getSettings().defaultModelId);
    if (!model) {
      throw new Error(wanted ? `No model named ${wanted}` : "No default model: set one in the app or pass EVAL_MODEL");
    }

    // Fixed description, so runs differ only by what we change.
    const project = await projects.addProject(repo);
    while (projects.isDescribing(project.id)) {
      await sleep(POLL_MS);
    }
    projects.saveProjectSettings(project.id, { description: fs.readFileSync(path.join(repo, "README.md"), "utf8"), ignoreGlobs: "", modelId: model.id });

    const only = process.env.EVAL_CASES?.split(",");
    const cases = ASK_CASES.filter((c) => !only || only.some((p) => c.name.startsWith(p)));
    const startedAt = new Date();
    const limit = limiter(parallel);

    const results = await Promise.all(
      cases.map((c) =>
        limit(async () => {
          const t0 = Date.now();
          const thread = chat.startThread(project.id, c.question);
          const question: UIMessage = { id: `q-${c.name}`, role: "user", parts: [{ type: "text", text: c.question }] };
          const response = await chat.projectChatResponse(project.id, thread.id, [question], c.mode);
          await response.text();

          // The thread is saved as the stream ends.
          const deadline = Date.now() + SAVE_TIMEOUT_MS;
          let answer: UIMessage | undefined;
          while (!answer && Date.now() < deadline) {
            answer = chat.loadThread(project.id, thread.id).find((m) => m.role === "assistant");
            await sleep(answer ? 0 : POLL_MS);
          }

          const score = { ...scoreAnswer(answer, c.files), seconds: Math.round((Date.now() - t0) / 1000) };
          console.log(`${c.name.padEnd(22)} ${score.cited.length}/${c.files.length} cited, ${score.toolCalls} tools, ${score.steps} rounds, ${score.seconds}s`);
          return { c, score, answer };
        }),
      ),
    );

    const summary = summarizeAsk(results.map((r) => r.score));
    const pct = Math.round((100 * summary.recall.hit) / Math.max(summary.recall.total, 1));
    console.log(`\nModel ${model.name}, ${summary.cases} questions`);
    console.log(`Recall      ${summary.recall.hit}/${summary.recall.total} (${pct}%), ${summary.complete} complete`);
    console.log(`Per answer  ${summary.toolCalls} tool calls, ${summary.steps} rounds, ${summary.input} in / ${summary.output} out tokens, ${summary.seconds}s`);
    console.log(`Stalls      ${summary.nudged} nudged, ${summary.unfinished} unfinished`);

    // Full answers, for reading why a file was missed.
    const label = process.env.EVAL_LABEL ?? "run";
    const file = path.join(RESULTS, `ask-${startedAt.toISOString().replace(/[:.]/g, "-")}-${label}.json`);
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
          cases: results.map(({ c, score, answer }) => ({ name: c.name, mode: c.mode, question: c.question, ...score, answer: answer?.parts })),
        },
        null,
        2,
      ),
    );
    console.log(`\n${file}`);

    expect(results).toHaveLength(cases.length);
  }, TIMEOUT_MS);
});
