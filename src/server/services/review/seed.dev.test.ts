import { describe, expect, it } from "vitest";
import { DiffMode, ProviderKind } from "@/lib/domain";

// Dev seed, skipped unless SEED_DEV=1: mock provider + sandbox project +
// two finished reviews in the dev database, for UI work.
//   node scripts/mock-llm.mjs 4010 &
//   SEED_DEV=1 REPO_ROOT=C:\git npx vitest run seed.dev
const MOCK_URL = "http://localhost:4010/v1";
const SANDBOX = "C:\\git\\pr-review-sandbox";
const TIMEOUT_MS = 120_000;
const POLL_MS = 200;

describe.skipIf(!process.env.SEED_DEV)("dev seed", () => {
  it("creates demo data", async () => {
    const providers = await import("../providers");
    const settings = await import("../settings");
    const projects = await import("../projects");
    const engine = await import("./engine");

    const existing = providers.listProviders().find((p) => p.baseUrl === MOCK_URL);
    const providerId = existing?.id ?? providers.saveProvider({ name: "Mock LLM", kind: ProviderKind.Compatible, baseUrl: MOCK_URL });
    const modelId = existing?.models[0]?.id ?? providers.saveModel({
      providerId,
      name: "mock-reviewer",
      contextWindow: 32_000,
      maxConcurrency: 4,
      inputCost: 0.5,
      outputCost: 1.5,
      toolCalling: true,
      jsonSchema: true,
    });
    settings.saveSettings({ ...settings.getSettings(), defaultModelId: modelId });

    const project = projects.listProjects().find((p) => p.path === SANDBOX) ?? (await projects.addProject(SANDBOX));
    const ids = [
      await engine.startReview(project.id, { mode: DiffMode.Uncommitted, base: null, head: null }),
      await engine.startReview(project.id, { mode: DiffMode.Branches, base: "main", head: "feature/discounts" }),
    ];

    for (const id of ids) {
      while (engine.isRunning(id)) {
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    }

    console.log(`Seeded project ${project.id}, reviews ${ids.join(", ")}`);
    expect(ids).toHaveLength(2);
  }, TIMEOUT_MS);
});
