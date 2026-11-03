"use client";

import { useTransition } from "react";
import { ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { summarizeReview, type Finding, type Report } from "@/app/reviews/actions";
import { Markdown } from "@/components/chat/markdown";
import { SeverityBadge } from "@/components/severity-badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FileState, FindingStatus, ruleKey } from "@/lib/domain";
import { isFinished, SEVERITIES } from "./report-lib";

// Recap once the review is done: counts, most hit rules, and the model's
// verdict with what to fix first. Counts follow live finding statuses; the
// verdict is rewritten on demand.
//
//   ▾ Review summary                                         [Regenerate]
//     [CRITICAL 1] [MAJOR 3] open · 2 fixed · 1 dismissed · 8/9 files · 1m 12s
//     Most hit: R3 Null checks ×4 · R7 Logging ×2
//     Fix #12 before merging: …

// Rules named in "Most hit".
const TOP_RULES = 3;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

type Props = {
  report: Report;
  findings: Finding[];
  running: boolean;
  onCite: (id: number) => void;
};

export function ReviewSummary({ report, findings, running, onCite }: Props) {
  const [pending, startTransition] = useTransition();
  const { review } = report;
  const unitsDone = report.units.length > 0 && report.units.every(isFinished);
  if (report.units.length === 0 || (running && !unitsDone)) {
    return null;
  }

  function regenerate() {
    startTransition(async () => {
      const result = await summarizeReview(review.id);
      if (result.error !== undefined) {
        toast.error(result.error);
      }
    });
  }

  return (
    <Collapsible defaultOpen className="border-b">
      <div className="flex items-center gap-2 pr-4">
        <CollapsibleTrigger className="group flex flex-1 items-center gap-1.5 px-4 py-2.5 text-left text-sm font-medium outline-none hover:bg-muted/50 focus-visible:bg-muted/50">
          <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-panel-open:rotate-90" aria-hidden />
          Review summary
        </CollapsibleTrigger>
        {!running && (
          <Button variant="ghost" size="xs" onClick={regenerate} disabled={pending} title="Rewrite the summary from the current open findings">
            {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {review.conclusion ? "Regenerate" : "Write summary"}
          </Button>
        )}
      </div>
      <CollapsibleContent>
        <div className="flex max-w-3xl flex-col gap-2.5 px-4 pb-3 pl-10 text-sm">
          <Counts report={report} findings={findings} />
          <TopRules report={report} findings={findings} />
          {review.conclusion ? (
            <div className="text-sm leading-relaxed">
              <Markdown text={review.conclusion} findingIds={new Set(findings.map((f) => f.id))} onCite={onCite} />
            </div>
          ) : (
            running && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Writing summary…
              </p>
            )
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// "[CRITICAL 1] [MAJOR 3] open · 2 fixed · 1 dismissed · 8/9 files reviewed · 1m 12s".
function Counts({ report, findings }: { report: Report; findings: Finding[] }) {
  const open = findings.filter((f) => f.status === FindingStatus.Open);
  const fixed = findings.filter((f) => f.status === FindingStatus.Fixed).length;
  const dismissed = findings.filter((f) => f.status === FindingStatus.Dismissed).length;
  const reviewed = report.files.filter((f) => f.state === FileState.Reviewed).length;
  const { createdAt, finishedAt } = report.review;
  const parts = [
    open.length === 0 ? "No open findings" : "open",
    fixed > 0 ? `${fixed} fixed` : null,
    dismissed > 0 ? `${dismissed} dismissed` : null,
    `${reviewed}/${report.files.length} files reviewed`,
    finishedAt ? formatDuration(new Date(finishedAt).getTime() - new Date(createdAt).getTime()) : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {SEVERITIES.map((s) => {
        const count = open.filter((f) => f.severity === s).length;
        if (count === 0) {
          return null;
        }

        return (
          <span key={s} className="inline-flex items-center gap-1">
            <SeverityBadge severity={s} />
            <span className="tabular-nums text-foreground">{count}</span>
          </span>
        );
      })}
      {parts.map((p, i) => (
        <span key={p} className={i > 0 ? "before:mr-1.5 before:content-['·']" : undefined}>
          {p}
        </span>
      ))}
    </div>
  );
}

// Rules with the most findings in this review, dismissed ones left out.
function TopRules({ report, findings }: { report: Report; findings: Finding[] }) {
  const names = new Map(report.rules.categories.flatMap((c) => c.rules.map((r) => [r.id, r.name] as const)));
  const counts = new Map<number, number>();
  for (const f of findings) {
    if (f.status === FindingStatus.Dismissed) {
      continue;
    }

    counts.set(f.ruleId, (counts.get(f.ruleId) ?? 0) + 1);
  }

  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, TOP_RULES);
  if (top.length === 0) {
    return null;
  }

  return (
    <p className="text-xs text-muted-foreground">
      Most hit:{" "}
      {top.map(([id, count], i) => (
        <span key={id} className={i > 0 ? "before:mx-1.5 before:content-['·']" : undefined}>
          <span className="font-mono">{ruleKey(id)}</span> {names.get(id) ?? "Deleted rule"} <span className="tabular-nums">×{count}</span>
        </span>
      ))}
    </p>
  );
}

// 72_000 → "1m 12s", 4_000 → "4s".
function formatDuration(ms: number): string {
  const seconds = Math.round(ms / MS_PER_SECOND);
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return minutes > 0 ? `${minutes}m ${seconds % SECONDS_PER_MINUTE}s` : `${seconds}s`;
}
