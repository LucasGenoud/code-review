import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UIMessage } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChangeScope, DiffMode, FileState, FindingStatus, ProviderKind, ReviewStatus, UnitStatus } from "@/lib/domain";

// End to end: real git repo + mock LLM server (scripts/mock-llm.mjs) through
// the whole pipeline: review, fix, refresh, re-review, chat, rule changes.

const PORT = 4099;
const TIMEOUT_MS = 60_000;
const POLL_MS = 100;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prr-int-"));
const repo = path.join(tmp, "repos", "app");
let mock: ChildProcess;

function git(...args: string[]) {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  fs.mkdirSync(repo, { recursive: true });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "app.py"), "def total(items):\n    return sum(items)\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");

  // Uncommitted edit + untracked file.
  fs.appendFileSync(
    path.join(repo, "app.py"),
    '\n\ndef report(items):\n    print("report start")\n    avg = total(items) / len(items)\n    print("avg", avg)\n    return avg\n',
  );
  fs.writeFileSync(path.join(repo, "new.py"), "x = None\nif x == None:\n    print(x)\n");

  process.env.REPO_ROOT = path.join(tmp, "repos");
  process.env.DATA_DIR = path.join(tmp, "data");

  mock = spawn(process.execPath, ["scripts/mock-llm.mjs", String(PORT)], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    const up = await fetch(`http://localhost:${PORT}/v1/models`).then(() => true, () => false);
    if (up) {
      break;
    }

    await sleep(POLL_MS);
  }
}, TIMEOUT_MS);

afterAll(() => {
  mock?.kill();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // Windows keeps the open SQLite file locked; the OS cleans temp later.
  }
});

async function untilIdle(reviewId: number) {
  const { isRunning } = await import("./engine");
  while (isRunning(reviewId)) {
    await sleep(POLL_MS);
  }
}

describe("review pipeline", () => {
  it("runs, fixes, refreshes, chats and learns", async () => {
    const providers = await import("../providers");
    const settings = await import("../settings");
    const projects = await import("../projects");
    const engine = await import("./engine");
    const reviews = await import("../reviews");
    const chat = await import("../chat");
    const changes = await import("../ruleChanges");
    const rules = await import("../rules");

    // Provider + default model pointing at the mock.
    const providerId = providers.saveProvider({
      name: "Mock",
      kind: ProviderKind.Compatible,
      baseUrl: `http://localhost:${PORT}/v1`,
    });
    expect(await providers.fetchModelNames(providerId)).toEqual(["mock-reviewer"]);
    const modelId = providers.saveModel({
      providerId,
      name: "mock-reviewer",
      contextWindow: 32_000,
      maxConcurrency: 2,
      inputCost: 1,
      outputCost: 2,
      toolCalling: true,
      jsonSchema: true,
    });
    settings.saveSettings({ ...settings.getSettings(), defaultModelId: modelId });

    const project = await projects.addProject(repo);
    const languages = await projects.projectLanguages(project.id);
    expect(languages.find((l) => l.name === "Python")?.files).toBe(1);

    // Review the working tree, untracked file included.
    const reviewId = await engine.startReview(project.id, { mode: DiffMode.Uncommitted, base: null, head: null });
    await untilIdle(reviewId);

    let report = reviews.getReport(reviewId);
    expect(report.review.status).toBe(ReviewStatus.Done);
    expect(report.review.summary).toContain("Mock overview");
    expect(report.files.map((f) => f.path)).toEqual(["app.py", "new.py"]);
    expect(report.files.every((f) => f.state === FileState.Reviewed)).toBe(true);
    expect(report.units.every((u) => u.status === UnitStatus.Done)).toBe(true);
    // Bugs pass + rules pass (Python pack) per file.
    expect(report.units).toHaveLength(4);
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report.review.cost).toBeGreaterThan(0);

    const ruleIds = new Set(report.rules.categories.flatMap((c) => c.rules.map((r) => r.id)));
    expect(report.findings.every((f) => ruleIds.has(f.ruleId))).toBe(true);
    expect(reviews.exportMarkdown(reviewId).markdown).toContain("# Code review: app");

    // Apply a suggested fix to the working tree.
    const fixable = report.findings.find((f) => f.replacement?.includes("logging.info"));
    expect(fixable).toBeDefined();
    await reviews.applyFix(fixable!.id);
    expect(fs.readFileSync(path.join(repo, fixable!.path), "utf8")).toContain("logging.info(");

    // Refresh sees the edit; re-review only the changed file.
    const refreshed = await engine.refreshReview(reviewId);
    expect(refreshed.changed).toBe(1);
    expect(engine.rereviewChanged(reviewId)).toBe(1);
    await untilIdle(reviewId);
    report = reviews.getReport(reviewId);
    expect(report.review.status).toBe(ReviewStatus.Done);
    expect(report.findings.find((f) => f.id === fixable!.id)?.status).toBe(FindingStatus.Fixed);

    // Chat answer is streamed and persisted.
    const question: UIMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Why #1?" }] };
    const response = await chat.chatResponse(reviewId, [question]);
    await response.text();
    await sleep(POLL_MS);
    expect(chat.loadChat(reviewId)).toHaveLength(2);

    // Dismiss → proposed rule change → accepted as a project override.
    const open = report.findings.find((f) => f.status === FindingStatus.Open)!;
    reviews.dismissFinding(open.id, "fine in scripts");
    expect(await changes.generateChanges(project.id)).toBe(1);
    const [change] = changes.listChanges(project.id);
    expect(change.ruleId).toBe(open.ruleId);
    changes.acceptChange(change.id, ChangeScope.Project);

    const rule = rules.projectRules(project.id).flatMap((c) => c.rules).find((r) => r.id === open.ruleId);
    expect(rule?.overridden).toBe(true);
    expect(rule?.text).toContain("except in test files");
  }, TIMEOUT_MS);
});
