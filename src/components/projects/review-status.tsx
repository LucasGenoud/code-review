import { cn } from "cn";
import { ReviewStatus } from "@/lib/domain";

const STATUS: Record<ReviewStatus, { label: string; className: string; dot: string }> = {
  [ReviewStatus.Running]: {
    label: "Running",
    className: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    dot: "bg-blue-500 animate-pulse",
  },
  [ReviewStatus.Done]: {
    label: "Done",
    className: "bg-green-500/10 text-green-700 dark:text-green-300",
    dot: "bg-green-500",
  },
  [ReviewStatus.Failed]: {
    label: "Failed",
    className: "bg-red-500/10 text-red-700 dark:text-red-300",
    dot: "bg-red-500",
  },
  [ReviewStatus.Canceled]: {
    label: "Canceled",
    className: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/60",
  },
};

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const COST_DECIMALS = 2;
const SMALL_COST = 0.01;

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

// Pill for a review's status, e.g. ● Running (pulsing).
export function ReviewStatusBadge({ status, className }: { status: ReviewStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium", s.className, className)}>
      <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
}

// "3 minutes ago", "yesterday". Server-rendered: no hydration drift.
export function timeAgo(date: Date): string {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);

  if (abs < MINUTE) {
    return "just now";
  }

  if (abs < HOUR) {
    return relative.format(Math.round(seconds / MINUTE), "minute");
  }

  if (abs < DAY) {
    return relative.format(Math.round(seconds / HOUR), "hour");
  }

  if (abs < MONTH) {
    return relative.format(Math.round(seconds / DAY), "day");
  }

  return date.toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
}

// "$0.42", "<$0.01".
export function formatCost(usd: number): string {
  if (usd > 0 && usd < SMALL_COST) {
    return "<$0.01";
  }

  return `$${usd.toFixed(COST_DECIMALS)}`;
}
