"use client";

import { useState } from "react";
import { DiffModeEnum, DiffView, getLang } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view-pure.css";
import "./diff.css";
import { AlertTriangle, EyeOff, RefreshCw } from "lucide-react";
import { cn } from "cn";
import type { Finding, ReviewFile, UnitView } from "@/app/reviews/actions";
import { Button } from "@/components/ui/button";
import { FileChange, FileState, FindingStatus, UnitStatus } from "@/lib/domain";
import { ChangeIcon } from "./file-list";
import { FindingStack } from "./finding-card";
import { PromptMenu } from "./prompt-dialog";
import { useReport } from "./report-context";
import { fileAnchor, isInDiff, lineStats, newLineRanges, sortFindings, splitPath } from "./report-lib";

// One changed file: sticky header, unified diff, findings inline under the
// line they end on. Findings outside the shown hunks are listed on top.

const DIFF_FONT_SIZE = 12;

type Theme = "light" | "dark";

type Props = {
  file: ReviewFile;
  units: UnitView[];
  // Findings of this file passing the category/severity filters, any status.
  findings: Finding[];
  theme: Theme;
};

export function FileDiff({ file, units, findings, theme }: Props) {
  const { categories } = useReport();
  const ranges = newLineRanges(file.patch);
  const sorted = sortFindings(findings, categories);
  const inline = sorted.filter((f) => isInDiff(f, file, ranges));
  const outside = sorted.filter((f) => !isInDiff(f, file, ranges));

  // Finding ids grouped by their last line: { "16": { data: [12, 13] } }.
  // Ids, not findings: the diff library deep-traverses this data.
  const extend: Record<string, { data: number[] }> = {};
  for (const f of inline) {
    (extend[f.endLine] ??= { data: [] }).data.push(f.id);
  }

  return (
    <section id={fileAnchor(file.id)} aria-label={file.path} className="scroll-mt-2 border-b">
      <FileHeader file={file} units={units} findings={findings} />

      {outside.length > 0 && (
        <div className="border-b bg-muted/20">
          <p className="px-4 pt-2 text-xs text-muted-foreground">Outside the shown diff</p>
          <FindingStack findings={outside} />
        </div>
      )}

      <FileBody file={file} extend={extend} findings={inline} theme={theme} />
    </section>
  );
}

function FileHeader({ file, units, findings }: Omit<Props, "theme">) {
  const { dir, name } = splitPath(file.path);
  const { added, removed } = lineStats(file.patch);
  const open = findings.filter((f) => f.status === FindingStatus.Open).length;
  const failed = units.filter((u) => u.status === UnitStatus.Failed).length;

  return (
    <header className="sticky top-0 z-10 flex h-10 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80">
      <ChangeIcon change={file.change} />
      <h2 className="min-w-0 truncate font-mono text-[13px]" title={file.path}>
        {file.oldPath && file.oldPath !== file.path && (
          <span className="text-muted-foreground">{file.oldPath} → </span>
        )}
        <span className="text-muted-foreground">{dir}</span>
        <span className="font-medium">{name}</span>
      </h2>

      <span className="shrink-0 font-mono text-xs tabular-nums">
        <span className="text-green-700 dark:text-green-400">+{added}</span>{" "}
        <span className="text-red-700 dark:text-red-400">−{removed}</span>
      </span>

      {file.state === FileState.Changed && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-500/10 px-2 text-[11px] font-medium text-blue-700 dark:text-blue-300">
          <RefreshCw className="size-3" aria-hidden />
          Changed
        </span>
      )}
      {failed > 0 && (
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-red-700 dark:text-red-400">
          <AlertTriangle className="size-3" aria-hidden />
          {failed} failed
        </span>
      )}

      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
        {open > 0 ? `${open} open` : ""}
      </span>
      <PromptMenu units={units} />
    </header>
  );
}

type BodyProps = {
  file: ReviewFile;
  extend: Record<string, { data: number[] }>;
  findings: Finding[];
  theme: Theme;
};

function FileBody({ file, extend, findings, theme }: BodyProps) {
  const [reveal, setReveal] = useState(false);
  const byId = new Map(findings.map((f) => [f.id, f]));
  const skipped = file.state === FileState.Skipped;

  // Binary files and pure renames have no hunks.
  if (!file.patch.includes("\n@@")) {
    return <Note>No textual changes{file.change === FileChange.Renamed ? " (renamed)" : " (binary or mode change)"}.</Note>;
  }

  if (skipped && !reveal) {
    return (
      <Note>
        <EyeOff className="size-3.5" aria-hidden />
        Not reviewed: {file.skipReason ?? "skipped"}.
        <Button size="xs" variant="ghost" onClick={() => setReveal(true)}>
          Show diff
        </Button>
      </Note>
    );
  }

  const lang = getLang(file.path);

  return (
    <div className={cn("report-diff", skipped && "opacity-70")}>
      <DiffView<number[]>
        data={{
          oldFile: { fileName: file.oldPath ?? file.path, fileLang: lang },
          newFile: { fileName: file.path, fileLang: lang },
          hunks: [file.patch],
        }}
        extendData={{ newFile: extend }}
        renderExtendLine={({ data }) => (
          <FindingStack findings={data.flatMap((id) => byId.get(id) ?? [])} />
        )}
        diffViewMode={DiffModeEnum.Unified}
        diffViewTheme={theme}
        diffViewFontSize={DIFF_FONT_SIZE}
        diffViewHighlight
        diffViewWrap
      />
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">{children}</p>;
}
