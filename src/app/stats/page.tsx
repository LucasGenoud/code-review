import { Suspense } from "react";
import Link from "next/link";
import { ChartColumn } from "lucide-react";
import { CategoryDot } from "@/components/category-badge";
import { formatCost } from "@/components/projects/review-status";
import { formatTokens } from "@/components/report/report-lib";
import { SeverityBadge } from "@/components/severity-badge";
import { ChartMetric } from "@/components/stats/chart-metric";
import { DailyChart } from "@/components/stats/daily-chart";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { FindingStatus, ruleKey } from "@/lib/domain";
import { globalStats, type RuleStats, type Spend, type Stats } from "./actions";

// Statistics over every stored review:
//   totals ─ daily spend chart ─ spend per model | per project
//   most triggered rules ─ findings by severity | by status

// Rules listed in "Most triggered rules".
const TOP_RULES = 15;
const PERCENT = 100;

const STATUS_LABELS: Record<FindingStatus, string> = {
  [FindingStatus.Open]: "Open",
  [FindingStatus.Fixed]: "Fixed",
  [FindingStatus.Dismissed]: "Dismissed",
  [FindingStatus.Outdated]: "Outdated",
};

export default function StatsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Statistics</h1>
        <p className="text-sm leading-6 text-muted-foreground">Spend and findings across every review. Deleted reviews no longer count.</p>
      </header>

      <Suspense fallback={<StatsSkeleton />}>
        <StatsView />
      </Suspense>
    </main>
  );
}

async function StatsView() {
  const stats = await globalStats();
  if (stats.total.reviews === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ChartColumn />
          </EmptyMedia>
          <EmptyTitle>No reviews yet</EmptyTitle>
          <EmptyDescription>Statistics appear once a project has been reviewed.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const priced = stats.total.cost > 0;

  return (
    <div className="flex flex-col gap-8">
      <Totals stats={stats} />

      <Section title={priced ? "Daily spend, last 30 days" : "Daily tokens, last 30 days"}>
        <Card className="px-4 py-3">
          <DailyChart days={stats.days} metric={priced ? ChartMetric.Cost : ChartMetric.Tokens} />
        </Card>
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Per model">
          <SpendTable rows={stats.models.map((m) => ({ key: m.label, label: m.label, spend: m }))} />
        </Section>
        <Section title="Per project">
          <SpendTable
            rows={stats.projects.map((p) => ({
              key: String(p.id),
              label: (
                <Link href={`/projects/${p.id}`} className="hover:underline">
                  {p.name}
                </Link>
              ),
              spend: p,
            }))}
          />
        </Section>
      </div>

      <Section title="Most triggered rules">
        <RulesTable rules={stats.rules.slice(0, TOP_RULES)} />
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Findings by severity">
          <Card className="gap-2 px-4 py-3">
            {stats.severities.map((s) => (
              <BarRow key={s.severity} label={<SeverityBadge severity={s.severity} />} value={s.count} max={stats.total.findings} />
            ))}
          </Card>
        </Section>
        <Section title="Findings by status">
          <Card className="gap-2 px-4 py-3">
            {Object.values(FindingStatus).map((s) => (
              <BarRow key={s} label={<span className="text-xs">{STATUS_LABELS[s]}</span>} value={stats.statuses[s]} max={stats.total.findings} />
            ))}
          </Card>
        </Section>
      </div>
    </div>
  );
}

// Headline numbers. Cost notes tokens of models without prices.
function Totals({ stats }: { stats: Stats }) {
  const { total } = stats;
  const tiles = [
    { label: "Cost", value: formatCost(total.cost), hint: total.unpriced > 0 ? `+ ${formatTokens(total.unpriced)} unpriced tokens` : null },
    { label: "Reviews", value: String(total.reviews), hint: null },
    { label: "Input tokens", value: formatTokens(total.input), hint: null },
    { label: "Output tokens", value: formatTokens(total.output), hint: null },
    { label: "Findings", value: String(total.findings), hint: null },
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => (
        <Card key={t.label} className="gap-0.5 px-4 py-3">
          <dt className="text-xs text-muted-foreground">{t.label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{t.value}</dd>
          {t.hint && (
            <dd className="text-[11px] text-muted-foreground">
              <Link href="/settings" className="hover:underline" title="Set model prices in Settings">
                {t.hint}
              </Link>
            </dd>
          )}
        </Card>
      ))}
    </dl>
  );
}

type SpendRow = { key: string; label: React.ReactNode; spend: Spend };

function SpendTable({ rows }: { rows: SpendRow[] }) {
  return (
    <Card className="overflow-x-auto py-0">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-4 py-2 text-left font-medium">Name</th>
            <th className="px-2 py-2 text-right font-medium">Reviews</th>
            <th className="px-2 py-2 text-right font-medium">In</th>
            <th className="px-2 py-2 text-right font-medium">Out</th>
            <th className="px-4 py-2 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y tabular-nums">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="max-w-48 truncate px-4 py-2">{r.label}</td>
              <td className="px-2 py-2 text-right">{r.spend.reviews}</td>
              <td className="px-2 py-2 text-right">{formatTokens(r.spend.input)}</td>
              <td className="px-2 py-2 text-right">{formatTokens(r.spend.output)}</td>
              <td className="px-4 py-2 text-right">
                {r.spend.unpriced > 0 && r.spend.cost === 0 ? <span className="text-muted-foreground" title="No prices set for this model">–</span> : formatCost(r.spend.cost)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// Dismissed share hints at noisy rules worth rewording or disabling.
function RulesTable({ rules }: { rules: RuleStats[] }) {
  if (rules.length === 0) {
    return <p className="text-sm text-muted-foreground">No findings yet.</p>;
  }

  const max = rules[0].total;

  return (
    <Card className="overflow-x-auto py-0">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-4 py-2 text-left font-medium">Rule</th>
            <th className="w-1/4 px-2 py-2 text-left font-medium">Findings</th>
            <th className="px-2 py-2 text-right font-medium">Open</th>
            <th className="px-2 py-2 text-right font-medium">Fixed</th>
            <th className="px-2 py-2 text-right font-medium">Dismissed</th>
            <th className="px-4 py-2 text-right font-medium" title="Share of findings the user dismissed">Dismiss rate</th>
          </tr>
        </thead>
        <tbody className="divide-y tabular-nums">
          {rules.map((r) => (
            <tr key={r.ruleId}>
              <td className="px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  {r.color && <CategoryDot color={r.color} />}
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{ruleKey(r.ruleId)}</span>
                  <span className="truncate" title={r.category ?? undefined}>
                    {r.name || <span className="text-muted-foreground">Deleted rule</span>}
                  </span>
                </div>
              </td>
              <td className="px-2 py-2">
                <Bar value={r.total} max={max} />
              </td>
              <td className="px-2 py-2 text-right">{r.open}</td>
              <td className="px-2 py-2 text-right">{r.fixed}</td>
              <td className="px-2 py-2 text-right">{r.dismissed}</td>
              <td className="px-4 py-2 text-right">{Math.round((r.dismissed / r.total) * PERCENT)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function BarRow({ label, value, max }: { label: React.ReactNode; value: number; max: number }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
      <div className="justify-self-start">{label}</div>
      <Bar value={value} max={max} />
    </div>
  );
}

// Horizontal magnitude bar with its count, e.g. ████░░░░ 12.
function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${max > 0 ? (value / max) * PERCENT : 0}%` }} />
      </div>
      <span className="w-8 text-right text-xs tabular-nums">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}

function StatsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}
