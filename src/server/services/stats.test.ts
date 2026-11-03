import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import { DiffMode, FileChange, FileState, FindingStatus, ProviderKind, ReviewStatus, Severity } from "@/lib/domain";
import type * as Stats from "./stats";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prr-stats-"));
const TODAY = new Date("2026-10-29T12:00:00Z");
const DELETED_RULE = 999_999;
let stats: typeof Stats;

beforeAll(async () => {
  process.env.DATA_DIR = path.join(tmp, "data");
  stats = await import("./stats");
});

it("sums spend per model, project and day, and counts findings per rule", async () => {
  const providerStore = await import("@/server/drivers/providerStore");
  const { insertProject } = await import("@/server/drivers/projectStore");
  const store = await import("@/server/drivers/reviewStore");
  const { rulesFor } = await import("@/server/drivers/ruleStore");
  const { getDb } = await import("@/server/drivers/db");
  const { reviews } = await import("@/server/drivers/schema");
  const { eq } = await import("drizzle-orm");

  const provider = providerStore.insertProvider({ name: "P", kind: ProviderKind.Compatible });
  // $1 per 1M input tokens, $2 per 1M output tokens.
  const priced = providerStore.insertModel({ providerId: provider.id, name: "priced", inputCost: 1, outputCost: 2 });
  const free = providerStore.insertModel({ providerId: provider.id, name: "free" });
  const project = insertProject("App", tmp);
  const rule = rulesFor(null)[0];

  function review(modelId: number, label: string, input: number, output: number, createdAt: Date) {
    const r = store.insertReview({
      projectId: project.id, mode: DiffMode.Uncommitted, baseSha: "x", modelId, modelLabel: label,
      status: ReviewStatus.Done, rules: '{"categories":[]}', inputTokens: input, outputTokens: output,
    });
    // Stores keep created_at to now; backdate for the daily chart.
    getDb().update(reviews).set({ createdAt }).where(eq(reviews.id, r.id)).run();
    return r;
  }

  const a = review(priced.id, "P / priced", 1_000_000, 500_000, TODAY);
  review(priced.id, "P / priced", 1_000_000, 0, new Date("2026-10-28T08:00:00Z"));
  review(free.id, "P / free", 300, 200, TODAY);

  const [file] = store.insertFiles([{ reviewId: a.id, path: "a.ts", change: FileChange.Added, patch: "", hash: "h", state: FileState.Reviewed }]);
  const finding = { reviewId: a.id, fileId: file.id, path: "a.ts", startLine: 1, endLine: 1, quote: "q", title: "t", explanation: "e" };
  store.insertFindings([
    { ...finding, ruleId: rule.id, categoryId: rule.categoryId, severity: Severity.Major, status: FindingStatus.Open },
    { ...finding, ruleId: rule.id, categoryId: rule.categoryId, severity: Severity.Major, status: FindingStatus.Dismissed },
    { ...finding, ruleId: DELETED_RULE, categoryId: rule.categoryId, severity: Severity.Info, status: FindingStatus.Fixed },
  ]);

  const s = stats.globalStats(TODAY);

  // 2M in × $1 + 0.5M out × $2; the free model's 500 tokens are unpriced.
  expect(s.total).toMatchObject({ reviews: 3, input: 2_000_300, output: 500_200, cost: 3, unpriced: 500, findings: 3 });
  expect(s.models.map((m) => [m.label, m.reviews, m.cost])).toEqual([["P / priced", 2, 3], ["P / free", 1, 0]]);
  expect(s.projects).toMatchObject([{ name: "App", reviews: 3, cost: 3 }]);

  expect(s.days).toHaveLength(30);
  expect(s.days.at(-1)).toMatchObject({ day: "2026-10-29", reviews: 2, cost: 2 });
  expect(s.days.at(-2)).toMatchObject({ day: "2026-10-28", reviews: 1, cost: 1 });
  expect(s.days[0]).toMatchObject({ day: "2026-09-30", reviews: 0 });

  expect(s.rules).toEqual([
    { ruleId: rule.id, name: rule.name, category: expect.any(String), color: expect.any(String), total: 2, open: 1, fixed: 0, dismissed: 1 },
    { ruleId: DELETED_RULE, name: null, category: expect.any(String), color: expect.any(String), total: 1, open: 0, fixed: 1, dismissed: 0 },
  ]);
  expect(s.severities).toEqual([
    { severity: Severity.Critical, count: 0 },
    { severity: Severity.Major, count: 2 },
    { severity: Severity.Minor, count: 0 },
    { severity: Severity.Info, count: 1 },
  ]);
  expect(s.statuses).toEqual({ open: 1, dismissed: 1, fixed: 1, outdated: 0 });
});
