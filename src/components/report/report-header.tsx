"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  ListChecks,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cancelReview, removeReview, rereviewChanged, retryReview, type Report } from "@/app/reviews/actions";
import { formatCost, ReviewStatusBadge } from "@/components/projects/review-status";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FileState, ReviewStatus } from "@/lib/domain";
import { formatTokens, isFinished } from "./report-lib";

// Report title, run metadata and review-level actions.
//
//   ← project / Review #3  ● Done            [Refresh] [Ask] [Export] [⋯]
//     main...feature · Model · 4.8K in · 0.7K out · $0.02

type Props = {
  report: Report;
  running: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenChat: () => void;
  onOpenFindings: () => void;
  openCount: number;
};

export function ReportHeader({ report, running, refreshing, onRefresh, onOpenChat, onOpenFindings, openCount }: Props) {
  const { review, project } = report;
  const [pending, startTransition] = useTransition();
  const changed = report.files.filter((f) => f.state === FileState.Changed).length;
  const canRetry = !running && (review.status === ReviewStatus.Failed || review.status === ReviewStatus.Canceled);

  // Runs a review-level action; shows its error, if any.
  function run(action: () => Promise<{ error?: string } | void>) {
    startTransition(async () => {
      const result = await action();
      if (result?.error) {
        toast.error(result.error);
      }
    });
  }

  return (
    <header className="border-b">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  href={`/projects/${project.id}`}
                  aria-label={`Back to ${project.name}`}
                  className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                />
              }
            >
              <ArrowLeft />
            </TooltipTrigger>
            <TooltipContent>Back to {project.name}</TooltipContent>
          </Tooltip>

          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm">
              <Link href={`/projects/${project.id}`} className="truncate text-muted-foreground hover:text-foreground">
                {project.name}
              </Link>
              <span className="text-muted-foreground/50">/</span>
              <h1 className="shrink-0 font-semibold">Review #{review.id}</h1>
              <ReviewStatusBadge status={running ? ReviewStatus.Running : review.status} />
            </div>
            <RunMeta report={report} />
          </div>
        </div>

        {running && <RunProgress report={report} />}

        <div className="ml-auto flex items-center gap-1.5">
          {running && (
            <Button variant="outline" size="sm" onClick={() => run(() => cancelReview(review.id))} disabled={pending}>
              <Square />
              Cancel
            </Button>
          )}
          {canRetry && (
            <Button variant="outline" size="sm" onClick={() => run(() => retryReview(review.id))} disabled={pending}>
              <RotateCcw />
              {review.status === ReviewStatus.Canceled ? "Resume" : "Retry"}
            </Button>
          )}
          {changed > 0 && !running && (
            <Button size="sm" onClick={() => run(() => rereviewChanged(review.id))} disabled={pending}>
              <RotateCcw />
              Re-review changed ({changed})
            </Button>
          )}

          <Tooltip>
            <TooltipTrigger
              render={<Button variant="outline" size="sm" onClick={onRefresh} disabled={running || refreshing} />}
            >
              {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Refresh
            </TooltipTrigger>
            <TooltipContent>Re-read the diff from disk (R)</TooltipContent>
          </Tooltip>

          <Button variant="outline" size="sm" className="xl:hidden" onClick={onOpenFindings}>
            <ListChecks />
            Findings
            <span className="text-muted-foreground tabular-nums">{openCount}</span>
          </Button>

          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="sm" onClick={onOpenChat} />}>
              <MessageSquare />
              Ask
            </TooltipTrigger>
            <TooltipContent>Chat about this review (C)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <a
                  href={`/api/reviews/${review.id}/export`}
                  download
                  aria-label="Export as Markdown"
                  className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                />
              }
            >
              <Download />
            </TooltipTrigger>
            <TooltipContent>Export as Markdown</TooltipContent>
          </Tooltip>

          <MoreMenu reviewId={review.id} projectId={project.id} running={running} />
        </div>
      </div>

      {review.status === ReviewStatus.Failed && review.error && !running && (
        <p role="alert" className="border-t bg-red-500/5 px-4 py-1.5 text-xs text-red-700 dark:text-red-300">
          <span className="font-medium">Review failed:</span> {review.error}
        </p>
      )}
    </header>
  );
}

// "Uncommitted changes · Mock LLM · 4.8K in · 769 out · $0.02".
function RunMeta({ report }: { report: Report }) {
  const { review } = report;
  const parts = [
    review.modelLabel,
    `${formatTokens(review.inputTokens)} in · ${formatTokens(review.outputTokens)} out tokens`,
    review.cost === null ? null : formatCost(review.cost),
  ].filter(Boolean);

  return (
    <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
      <span className="font-mono text-foreground/80">{review.rangeLabel}</span>
      {parts.map((p) => (
        <span key={p} className="before:mr-1.5 before:content-['·']">
          {p}
        </span>
      ))}
    </p>
  );
}

function RunProgress({ report }: { report: Report }) {
  const total = report.units.length;
  const done = report.units.filter(isFinished).length;

  return (
    <div className="flex w-48 items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
      <Progress value={total === 0 ? null : (done / total) * 100} className="flex-1" aria-label="Review progress" />
      <span className="shrink-0 tabular-nums">{total === 0 ? "Planning…" : `${done}/${total} units`}</span>
    </div>
  );
}

// Overflow menu: delete (with confirmation, then back to the project).
function MoreMenu({ reviewId, projectId, running }: { reviewId: number; projectId: number; running: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await removeReview(reviewId);
      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(`Review #${reviewId} deleted`);
      router.push(`/projects/${projectId}`);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem variant="destructive" disabled={running} onClick={() => setConfirming(true)}>
            <Trash2 />
            Delete review
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete review #{reviewId}?</AlertDialogTitle>
            <AlertDialogDescription>Its findings and chat are deleted. Your files are not touched.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
