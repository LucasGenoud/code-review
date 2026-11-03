import { count, eq, sql } from "drizzle-orm";
import type { FindingStatus, Severity } from "@/lib/domain";
import { getDb } from "./db";
import { categories, findings, projects, reviews, rules } from "./schema";

// Aggregates over every review, for the statistics page.

// Token use of reviews per project, model and UTC day.
//   { projectId: 1, modelId: 2, modelLabel: "OpenAI / gpt-5", day: "2026-10-29", reviews: 3, … }
export type UsageRow = {
  projectId: number;
  projectName: string;
  modelId: number | null;
  modelLabel: string;
  day: string;
  reviews: number;
  input: number;
  output: number;
};

// Finding counts per rule, severity and status. Names are null once the
// rule or category is deleted.
export type FindingRow = {
  ruleId: number;
  ruleName: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  severity: Severity;
  status: FindingStatus;
  count: number;
};

export function usageRows(): UsageRow[] {
  // created_at holds unix seconds.
  const day = sql<string>`date(${reviews.createdAt}, 'unixepoch')`;
  return getDb()
    .select({
      projectId: reviews.projectId,
      projectName: projects.name,
      modelId: reviews.modelId,
      modelLabel: reviews.modelLabel,
      day,
      reviews: count(),
      input: sql<number>`coalesce(sum(${reviews.inputTokens}), 0)`.mapWith(Number),
      output: sql<number>`coalesce(sum(${reviews.outputTokens}), 0)`.mapWith(Number),
    })
    .from(reviews)
    .innerJoin(projects, eq(projects.id, reviews.projectId))
    .groupBy(reviews.projectId, reviews.modelId, reviews.modelLabel, day)
    .all();
}

export function findingRows(): FindingRow[] {
  return getDb()
    .select({
      ruleId: findings.ruleId,
      ruleName: rules.name,
      categoryName: categories.name,
      categoryColor: categories.color,
      severity: findings.severity,
      status: findings.status,
      count: count(),
    })
    .from(findings)
    .leftJoin(rules, eq(rules.id, findings.ruleId))
    .leftJoin(categories, eq(categories.id, findings.categoryId))
    .groupBy(findings.ruleId, findings.categoryId, findings.severity, findings.status)
    .all();
}
