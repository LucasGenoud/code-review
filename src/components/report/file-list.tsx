"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "cn";
import type { Finding, ReviewFile, UnitView } from "@/app/reviews/actions";
import { CategoryDot } from "@/components/category-badge";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FileChange, FileState, FindingStatus, UnitStatus } from "@/lib/domain";
import { fileAnchor, isFinished, splitPath, type Category } from "./report-lib";

// Left pane: changed files with open findings per category and review state.

const CHANGE: Record<FileChange, { letter: string; label: string; className: string }> = {
  [FileChange.Added]: { letter: "A", label: "Added", className: "bg-green-500/10 text-green-700 dark:text-green-400" },
  [FileChange.Modified]: { letter: "M", label: "Modified", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  [FileChange.Deleted]: { letter: "D", label: "Deleted", className: "bg-red-500/10 text-red-700 dark:text-red-400" },
  [FileChange.Renamed]: { letter: "R", label: "Renamed", className: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
};

type Props = {
  files: ReviewFile[];
  units: UnitView[];
  findings: Finding[];
  categories: Map<number, Category>;
};

export function FileList({ files, units, findings, categories }: Props) {
  return (
    <nav aria-label="Changed files" className="flex h-full flex-col">
      <h2 className="px-3 pt-3 pb-1.5 text-xs font-medium text-muted-foreground">
        {files.length} {files.length === 1 ? "file" : "files"}
      </h2>

      <ul className="flex-1 px-1.5 pb-2">
        {files.map((file) => (
          <FileRow
            key={file.id}
            file={file}
            units={units.filter((u) => u.fileId === file.id)}
            findings={findings.filter((f) => f.fileId === file.id && f.status === FindingStatus.Open)}
            categories={categories}
          />
        ))}
      </ul>

      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        Press <Kbd>?</Kbd> for shortcuts
      </p>
    </nav>
  );
}

function FileRow({ file, units, findings, categories }: Omit<Props, "files"> & { file: ReviewFile }) {
  const { dir, name } = splitPath(file.path);
  const skipped = file.state === FileState.Skipped;

  return (
    <li>
      <a
        href={`#${fileAnchor(file.id)}`}
        onClick={(e) => {
          e.preventDefault();
          document.getElementById(fileAnchor(file.id))?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        className={cn(
          "flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
          skipped && "opacity-50",
        )}
      >
        <ChangeIcon change={file.change} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>
          <span className="text-muted-foreground">{dir}</span>
          {name}
        </span>
        <FileStatus file={file} units={units} />
        <CategoryCounts findings={findings} categories={categories} />
      </a>
    </li>
  );
}

// Open findings per category, e.g. ●2 ●1.
function CategoryCounts({ findings, categories }: { findings: Finding[]; categories: Map<number, Category> }) {
  const counts = new Map<number, number>();
  for (const f of findings) {
    counts.set(f.categoryId, (counts.get(f.categoryId) ?? 0) + 1);
  }

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {[...counts].map(([id, n]) => (
        <span key={id} className="flex items-center gap-0.5 text-[11px] text-muted-foreground tabular-nums" title={`${n} open in ${categories.get(id)?.name ?? "category"}`}>
          <CategoryDot color={categories.get(id)?.color ?? "slate"} className="size-1.5" />
          {n}
        </span>
      ))}
    </span>
  );
}

// Skipped / changed / failed / in progress, as a small icon with a tooltip.
function FileStatus({ file, units }: { file: ReviewFile; units: UnitView[] }) {
  const failed = units.find((u) => u.status === UnitStatus.Failed);
  const active = units.some((u) => u.status === UnitStatus.Running || u.status === UnitStatus.Pending);

  if (file.state === FileState.Skipped) {
    return <StatusHint label={`Skipped: ${file.skipReason ?? "not reviewed"}`}>skipped</StatusHint>;
  }

  if (file.state === FileState.Changed) {
    return (
      <StatusHint label="Changed since review. Re-review to update findings.">
        <span className="size-1.5 rounded-full bg-blue-500" />
      </StatusHint>
    );
  }

  if (failed) {
    return (
      <StatusHint label={`Review failed: ${failed.error ?? "unknown error"}`}>
        <AlertTriangle className="size-3.5 text-red-600 dark:text-red-400" />
      </StatusHint>
    );
  }

  if (active) {
    return (
      <StatusHint label="Reviewing">
        <Loader2 className="size-3 animate-spin" />
        <span className="tabular-nums">
          {units.filter(isFinished).length}/{units.length}
        </span>
      </StatusHint>
    );
  }

  return null;
}

function StatusHint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span aria-label={label} className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ChangeIcon({ change }: { change: FileChange }) {
  const c = CHANGE[change];
  return (
    <span
      title={c.label}
      className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-sm font-mono text-[10px] font-semibold", c.className)}
    >
      <span aria-hidden>{c.letter}</span>
      <span className="sr-only">{c.label}</span>
    </span>
  );
}
