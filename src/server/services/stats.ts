import { FindingStatus, Severity, SEVERITY_RANK } from "@/lib/domain";
import { findingRows, usageRows, type FindingRow, type UsageRow } from "@/server/drivers/statsStore";
import { tokenCost } from "./providers";

// Global statistics over every stored review: spend per model, project and
// day, and which rules find the most. Deleted reviews no longer count.
//
//   usage rows (project × model × day) ─┬─► total, models, projects, days
//   finding rows (rule × severity × status) ─► rules, severities, statuses

// Tokens and USD. cost covers priced models only; unpriced counts the
// tokens of models without prices, so totals can say they are partial.
export type Spend = { reviews: number; input: number; output: number; cost: number; unpriced: number };

export type ModelStats = Spend & { label: string };
export type ProjectStats = Spend & { id: number; name: string };
export type DayStats = Spend & { day: string };

export type RuleStats = {
  ruleId: number;
  // Null once the rule was deleted.
  name: string | null;
  category: string | null;
  color: string | null;
  total: number;
  open: number;
  fixed: number;
  dismissed: number;
};

export type Stats = {
  total: Spend & { findings: number };
  models: ModelStats[];
  projects: ProjectStats[];
  // Oldest first, days without reviews included.
  days: DayStats[];
  // Most findings first.
  rules: RuleStats[];
  // Most severe first.
  severities: { severity: Severity; count: number }[];
  statuses: Record<FindingStatus, number>;
};

// Days shown in the daily chart, today included.
const CHART_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// ISO date length, e.g. "2026-10-29".
const DAY_CHARS = 10;

export function globalStats(today = new Date()): Stats {
  const usage = usageRows();
  const found = findingRows();

  return {
    total: { ...sum(usage), findings: found.reduce((n, r) => n + r.count, 0) },
    models: group(usage, (r) => `${r.modelId}|${r.modelLabel}`)
      .map((rows) => ({ label: rows[0].modelLabel, ...sum(rows) }))
      .sort(bySpend),
    projects: group(usage, (r) => String(r.projectId))
      .map((rows) => ({ id: rows[0].projectId, name: rows[0].projectName, ...sum(rows) }))
      .sort(bySpend),
    days: lastDays(today).map((day) => ({ day, ...sum(usage.filter((r) => r.day === day)) })),
    rules: ruleStats(found),
    severities: Object.values(Severity)
      .sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])
      .map((severity) => ({ severity, count: total(found.filter((r) => r.severity === severity)) })),
    statuses: Object.fromEntries(
      Object.values(FindingStatus).map((s) => [s, total(found.filter((r) => r.status === s))]),
    ) as Record<FindingStatus, number>,
  };
}

function sum(rows: UsageRow[]): Spend {
  const spend: Spend = { reviews: 0, input: 0, output: 0, cost: 0, unpriced: 0 };
  for (const r of rows) {
    spend.reviews += r.reviews;
    spend.input += r.input;
    spend.output += r.output;

    const cost = tokenCost(r.modelId, r.input, r.output);
    if (cost === null) {
      spend.unpriced += r.input + r.output;
      continue;
    }

    spend.cost += cost;
  }

  return spend;
}

// Highest cost first, then most tokens: unpriced models still rank.
function bySpend(a: Spend, b: Spend): number {
  return b.cost - a.cost || b.input + b.output - (a.input + a.output);
}

function group<T>(rows: T[], key: (row: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  return [...groups.values()];
}

function total(rows: FindingRow[]): number {
  return rows.reduce((n, r) => n + r.count, 0);
}

// One entry per rule, with its findings split by status.
function ruleStats(rows: FindingRow[]): RuleStats[] {
  return group(rows, (r) => String(r.ruleId))
    .map((rs) => ({
      ruleId: rs[0].ruleId,
      name: rs[0].ruleName,
      category: rs[0].categoryName,
      color: rs[0].categoryColor,
      total: total(rs),
      open: total(rs.filter((r) => r.status === FindingStatus.Open)),
      fixed: total(rs.filter((r) => r.status === FindingStatus.Fixed)),
      dismissed: total(rs.filter((r) => r.status === FindingStatus.Dismissed)),
    }))
    .sort((a, b) => b.total - a.total);
}

// UTC dates of the chart, oldest first: ["2026-09-30", …, "2026-10-29"].
function lastDays(today: Date): string[] {
  return Array.from({ length: CHART_DAYS }, (_, i) =>
    new Date(today.getTime() - (CHART_DAYS - 1 - i) * MS_PER_DAY).toISOString().slice(0, DAY_CHARS),
  );
}
