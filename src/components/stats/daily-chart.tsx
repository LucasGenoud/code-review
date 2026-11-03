"use client";

import { useState } from "react";
import { cn } from "cn";
import type { DayStats } from "@/app/stats/actions";
import { formatCost } from "@/components/projects/review-status";
import { formatTokens } from "@/components/report/report-lib";
import { ChartMetric } from "./chart-metric";

// Bars of daily spend, oldest left. Hovering or focusing a bar shows its
// day; without any priced model the bars show tokens instead of USD.
//
//   $1.20 ┤            ▆
//         │   ▂     ▄  █  ▁
//         └─────────────────  Oct 1 … Oct 29
//   Oct 27 · $0.42 · 3 reviews · 120K in · 8K out

const CHART_HEIGHT_PX = 128;
// Bars of empty days stay visible as a baseline tick.
const MIN_BAR_PX = 2;

const dayLabel = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

export function DailyChart({ days, metric }: { days: DayStats[]; metric: ChartMetric }) {
  const [active, setActive] = useState<number | null>(null);
  const value = (d: DayStats) => (metric === ChartMetric.Cost ? d.cost : d.input + d.output);
  const format = (n: number) => (metric === ChartMetric.Cost ? formatCost(n) : formatTokens(n));
  const max = Math.max(...days.map(value));
  const shown = days[active ?? days.length - 1];

  return (
    <div className="flex flex-col gap-2">
      <p className="h-4 text-xs text-muted-foreground tabular-nums" aria-live="polite">
        <span className="font-medium text-foreground">{label(shown.day)}</span>
        {` · ${format(value(shown))} · ${shown.reviews} ${shown.reviews === 1 ? "review" : "reviews"} · ${formatTokens(shown.input)} in · ${formatTokens(shown.output)} out`}
      </p>

      <div className="flex items-end gap-0.5" style={{ height: CHART_HEIGHT_PX }} onMouseLeave={() => setActive(null)}>
        {days.map((d, i) => (
          <button
            key={d.day}
            type="button"
            aria-label={`${label(d.day)}: ${format(value(d))}`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            className="group flex h-full flex-1 items-end outline-none"
          >
            <span
              className={cn(
                "w-full rounded-t-[4px] transition-colors",
                value(d) > 0 ? "bg-primary/70 group-hover:bg-primary group-focus-visible:bg-primary" : "bg-border",
                active === i && "bg-primary",
              )}
              style={{ height: max > 0 && value(d) > 0 ? Math.max(MIN_BAR_PX, (value(d) / max) * CHART_HEIGHT_PX) : MIN_BAR_PX }}
            />
          </button>
        ))}
      </div>

      <div className="flex justify-between border-t pt-1 text-[11px] text-muted-foreground">
        <span>{label(days[0].day)}</span>
        <span>{label(days[days.length - 1].day)}</span>
      </div>
    </div>
  );
}

// "2026-10-29" → "Oct 29".
function label(day: string): string {
  return dayLabel.format(new Date(day));
}
