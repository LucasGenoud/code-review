"use client";

import { CheckCircle2, ListFilter } from "lucide-react";
import { cn } from "cn";
import type { Finding } from "@/app/reviews/actions";
import { CategoryDot } from "@/components/category-badge";
import { SeverityBadge } from "@/components/severity-badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SEVERITY_CLASSES } from "@/lib/colors";
import { FindingStatus, Severity } from "@/lib/domain";
import {
  ALL,
  DEFAULT_FILTERS,
  listAnchor,
  matchesScope,
  matchesStatus,
  SEVERITIES,
  type Category,
  type Filters,
  type StatusFilter,
} from "./report-lib";

// Right pane: severity totals, filters and the sorted findings list.

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: FindingStatus.Open, label: "Open" },
  { value: FindingStatus.Dismissed, label: "Dismissed" },
  { value: FindingStatus.Fixed, label: "Fixed" },
  { value: FindingStatus.Outdated, label: "Outdated" },
  { value: ALL, label: "All statuses" },
];

type Props = {
  // All findings (optimistic) and the filtered, sorted list.
  findings: Finding[];
  listed: Finding[];
  categories: Map<number, Category>;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  running: boolean;
};

export function FindingsPanel({ findings, listed, categories, filters, onFiltersChange, selectedId, onSelect, running }: Props) {
  // Each facet counts findings passing every other filter.
  const byStatus = findings.filter((f) => matchesStatus(f, filters.status));
  const severityPool = byStatus.filter((f) => matchesScope(f, { ...filters, severities: [] }, categories));
  const categoryPool = byStatus.filter((f) => matchesScope(f, { ...filters, categories: [] }, categories));

  // Only categories this review has findings in, e.g. not every language.
  const used = new Set(findings.map((f) => f.categoryId));

  const update = (patch: Partial<Filters>) => onFiltersChange({ ...filters, ...patch });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-3 border-b p-3">
        <h2 className="flex items-baseline gap-2 text-sm font-semibold">
          Findings
          <span className="text-xs font-normal text-muted-foreground tabular-nums">{listed.length} shown</span>
        </h2>

        <div className="grid grid-cols-4 gap-1" role="group" aria-label="Filter by severity">
          {SEVERITIES.map((s) => (
            <SeverityTotal
              key={s}
              severity={s}
              count={severityPool.filter((f) => f.severity === s).length}
              pressed={filters.severities.includes(s)}
              onToggle={() => update({ severities: toggle(filters.severities, s) })}
            />
          ))}
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by category">
          {[...categories.values()].filter((c) => used.has(c.id)).map((c) => (
            <CategoryChip
              key={c.id}
              category={c}
              count={categoryPool.filter((f) => f.categoryId === c.id).length}
              pressed={filters.categories.includes(c.id)}
              onToggle={() => update({ categories: toggle(filters.categories, c.id) })}
            />
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Select<StatusFilter> items={STATUS_OPTIONS} value={filters.status} onValueChange={(v) => v && update({ status: v })}>
            <SelectTrigger size="sm" aria-label="Filter by status" className="min-w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Label className="gap-2 text-xs font-normal">
            <Switch size="sm" checked={filters.bugsOnly} onCheckedChange={(bugsOnly) => update({ bugsOnly })} />
            Bugs only
          </Label>

          {!isDefault(filters) && (
            <Button variant="link" size="xs" className="ml-auto px-0 text-muted-foreground" onClick={() => onFiltersChange(DEFAULT_FILTERS)}>
              Reset
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {listed.length === 0 ? (
          <NoFindings total={findings.length} running={running} filtered={!isDefault(filters)} onReset={() => onFiltersChange(DEFAULT_FILTERS)} />
        ) : (
          <ul className="flex flex-col gap-px p-1.5" aria-label="Findings">
            {listed.map((f) => (
              <FindingItem key={f.id} finding={f} category={categories.get(f.categoryId)} selected={f.id === selectedId} onSelect={onSelect} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SeverityTotal({ severity, count, pressed, onToggle }: { severity: Severity; count: number; pressed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        "flex flex-col items-start rounded-md border px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
        pressed && "border-foreground/40 bg-muted",
        count === 0 && !pressed && "opacity-50",
      )}
    >
      <span className="text-base leading-none font-semibold tabular-nums">{count}</span>
      <span className={cn("mt-1 rounded px-1 text-[10px] font-semibold tracking-wide uppercase", SEVERITY_CLASSES[severity])}>{severity}</span>
    </button>
  );
}

function CategoryChip({ category, count, pressed, onToggle }: { category: Category; count: number; pressed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
        pressed ? "border-foreground/40 bg-muted font-medium" : "text-muted-foreground",
      )}
    >
      <CategoryDot color={category.color} className="size-1.5" />
      {category.name}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function FindingItem({ finding: f, category, selected, onSelect }: { finding: Finding; category?: Category; selected: boolean; onSelect: (id: number) => void }) {
  const closed = f.status !== FindingStatus.Open;

  return (
    <li id={listAnchor(f.id)}>
      <button
        type="button"
        aria-current={selected || undefined}
        onClick={() => onSelect(f.id)}
        className={cn(
          "flex w-full gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
          selected && "bg-muted",
          closed && "opacity-60",
        )}
      >
        <CategoryDot color={category?.color ?? "slate"} className="mt-1.5" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("line-clamp-2 text-[13px] leading-snug", closed && "line-through decoration-muted-foreground/50")}>{f.title}</span>
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
              {f.path}:{f.startLine}
            </span>
            <SeverityBadge severity={f.severity} className="ml-auto h-4 px-1 text-[10px]" />
          </span>
        </span>
      </button>
    </li>
  );
}

function NoFindings({ total, running, filtered, onReset }: { total: number; running: boolean; filtered: boolean; onReset: () => void }) {
  if (total === 0 && running) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle className="text-sm">No findings yet</EmptyTitle>
          <EmptyDescription>Findings appear here as files are reviewed.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (total === 0) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CheckCircle2 />
          </EmptyMedia>
          <EmptyTitle className="text-sm">Clean: no issues found</EmptyTitle>
          <EmptyDescription>The review found nothing against your rules.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ListFilter />
        </EmptyMedia>
        <EmptyTitle className="text-sm">{filtered ? "No findings for these filters" : "No open findings"}</EmptyTitle>
        {!filtered && <EmptyDescription>Every finding is dismissed, fixed or outdated.</EmptyDescription>}
      </EmptyHeader>
      {filtered && (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onReset}>
            Reset filters
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function isDefault(f: Filters): boolean {
  return f.categories.length === 0 && f.severities.length === 0 && f.status === DEFAULT_FILTERS.status && !f.bugsOnly;
}
