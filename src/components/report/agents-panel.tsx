"use client";

import { useState } from "react";
import { AlertTriangle, Bot, Check, ChevronRight, Clock, Compass, Loader2, Search, Send, XCircle } from "lucide-react";
import { cn } from "cn";
import type { Finding, OrchestratorView, ReviewFile, UnitView } from "@/app/reviews/actions";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { UnitStatus } from "@/lib/domain";
import { fileAnchor, splitPath, unitName } from "./report-lib";

// Who does what in a review, live:
//
//   ┌ Orchestrator ─ "Waiting for 4 reviewers" ──────────────────────┐
//   │ log: explored · spawned "Refund flow" · rejected #12 · summary  │
//   ├ Tasks  [All 12] [Running 2] [Queued 6] [Done 4] [Failed 0]      ┤
//   │ ⟳ Refund flow  [pay.ts] [invoice.ts]                            │
//   │   brief: "balance() now returns cents; check callers…"          │
//   │   ▸ ⟳ Bugs agent   Reading money.ts:1-80          2 findings    │
//   │   ▸ ✓ Rules check                                 1 finding     │
//   └─────────────────────────────────────────────────────────────────┘

// Sheet exit transition is 200 ms.
const SHEET_CLOSE_MS = 250;

enum Filter {
  All = "all",
  Running = "running",
  Queued = "queued",
  Done = "done",
  Failed = "failed",
}

const FILTER_STATUS: Record<Filter, UnitStatus | null> = {
  [Filter.All]: null,
  [Filter.Running]: UnitStatus.Running,
  [Filter.Queued]: UnitStatus.Pending,
  [Filter.Done]: UnitStatus.Done,
  [Filter.Failed]: UnitStatus.Failed,
};

const FILTER_LABEL: Record<Filter, string> = {
  [Filter.All]: "All",
  [Filter.Running]: "Running",
  [Filter.Queued]: "Queued",
  [Filter.Done]: "Done",
  [Filter.Failed]: "Failed",
};

// Running first, then queued in run order, then finished.
const STATUS_ORDER: Record<UnitStatus, number> = {
  [UnitStatus.Running]: 0,
  [UnitStatus.Pending]: 1,
  [UnitStatus.Failed]: 2,
  [UnitStatus.Done]: 3,
};

// Orchestrator log lines by their prefix, e.g. "Rejected #12 …".
const LOG_KINDS = [
  { prefix: "Spawned", icon: Send, className: "text-primary" },
  { prefix: "Rejected", icon: XCircle, className: "text-red-600 dark:text-red-400" },
  { prefix: "Explored:", icon: Search, className: "text-muted-foreground" },
  { prefix: "Summary:", icon: Check, className: "text-green-700 dark:text-green-400" },
  { prefix: "Orchestrator stopped", icon: AlertTriangle, className: "text-amber-600 dark:text-amber-400" },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  running: boolean;
  orchestrator: OrchestratorView;
  units: UnitView[];
  files: ReviewFile[];
  findings: Finding[];
  onSelectFinding: (id: number) => void;
};

export function AgentsPanel({ open, onOpenChange, running, orchestrator, units, files, findings, onSelectFinding }: Props) {
  const [filter, setFilter] = useState(Filter.All);
  const paths = new Map(files.map((f) => [f.id, f.path]));
  const status = FILTER_STATUS[filter];
  const shown = tasksOf(units.filter((u) => status === null || u.status === status), paths);

  function goToFile(fileId: number) {
    onOpenChange(false);
    setTimeout(() => document.getElementById(fileAnchor(fileId))?.scrollIntoView({ behavior: "smooth", block: "start" }), SHEET_CLOSE_MS);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Agents</SheetTitle>
          <SheetDescription>
            An orchestrator splits the change into tasks, briefs a reviewer agent for each, then checks what they report.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <OrchestratorCard orchestrator={orchestrator} running={running} />

          <section aria-label="Reviewers" className="px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="mr-auto text-sm font-medium">
                Tasks <span className="text-muted-foreground tabular-nums">{tasksOf(units, paths).length}</span>
              </h3>
              <span className="text-xs text-muted-foreground">Reviewers:</span>
              {Object.values(Filter).map((f) => {
                const count = FILTER_STATUS[f] === null ? units.length : units.filter((u) => u.status === FILTER_STATUS[f]).length;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    aria-pressed={filter === f}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                      filter === f ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {FILTER_LABEL[f]} <span className="tabular-nums">{count}</span>
                  </button>
                );
              })}
            </div>

            {units.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {running ? "No reviewers yet: the orchestrator is planning." : "No reviewers ran."}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {shown.map((task) => (
                  <TaskCard
                    key={task.key}
                    task={task}
                    paths={paths}
                    findings={findings}
                    onFile={goToFile}
                    onFinding={(id) => {
                      onOpenChange(false);
                      onSelectFinding(id);
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function OrchestratorCard({ orchestrator, running }: { orchestrator: OrchestratorView; running: boolean }) {
  const active = running && orchestrator.activity;
  // Exploration lines are many and minor: counted, shown on demand.
  const [showExplored, setShowExplored] = useState(false);
  const explored = orchestrator.log.filter((l) => l.startsWith("Explored:")).length;
  const lines = orchestrator.log.filter((l) => showExplored || !l.startsWith("Explored:"));

  return (
    <section aria-label="Orchestrator" className="border-b bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Compass className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Orchestrator</h3>
          <p className="truncate text-xs text-muted-foreground">Plans the review, briefs reviewers, checks their findings</p>
        </div>
        <StatusPill status={active ? UnitStatus.Running : orchestrator.log.length > 0 ? UnitStatus.Done : UnitStatus.Pending} label={active ? orchestrator.activity! : undefined} />
      </div>

      {orchestrator.log.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {running ? "Reading the change…" : "No orchestrator log: this review was planned in one call (model without tool calling) or before orchestration existed."}
        </p>
      ) : (
        <ol className="mt-3 flex flex-col gap-1.5 border-l pl-3 text-xs">
          {lines.map((line, i) => (
            <LogLine key={i} line={line} />
          ))}
        </ol>
      )}

      {explored > 0 && (
        <button
          type="button"
          onClick={() => setShowExplored((v) => !v)}
          className="mt-2 text-xs text-muted-foreground underline-offset-2 outline-none hover:underline focus-visible:underline"
        >
          {showExplored ? "Hide" : "Show"} {explored} exploration {explored === 1 ? "step" : "steps"}
        </button>
      )}
    </section>
  );
}

function LogLine({ line }: { line: string }) {
  const kind = LOG_KINDS.find((k) => line.startsWith(k.prefix));
  const Icon = kind?.icon ?? ChevronRight;

  return (
    <li className="flex gap-2">
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", kind?.className ?? "text-muted-foreground")} aria-hidden />
      <span className="min-w-0 leading-relaxed break-words">{line}</span>
    </li>
  );
}

// Reviewers sharing a task: same title and files, one per pass.
type Task = { key: string; title: string; focus: string | null; fileIds: number[]; units: UnitView[] };

// Tasks in work order: running first, then queued, then finished.
function tasksOf(units: UnitView[], paths: Map<number, string>): Task[] {
  const tasks = new Map<string, Task>();
  for (const u of [...units].sort((a, b) => a.id - b.id)) {
    const key = `${u.title ?? ""}|${u.fileIds.join(",")}|${u.chunk}`;
    const task = tasks.get(key) ?? { key, title: unitName(u, paths), focus: u.focus, fileIds: u.fileIds, units: [] };
    task.units.push(u);
    tasks.set(key, task);
  }

  return [...tasks.values()].sort((a, b) => STATUS_ORDER[taskStatus(a)] - STATUS_ORDER[taskStatus(b)]);
}

// Running if any reviewer runs, else queued, failed, done.
function taskStatus(task: Task): UnitStatus {
  return Object.values(UnitStatus).sort((a, b) => STATUS_ORDER[a] - STATUS_ORDER[b]).find((s) => task.units.some((u) => u.status === s)) ?? UnitStatus.Done;
}

type TaskProps = {
  task: Task;
  paths: Map<number, string>;
  findings: Finding[];
  onFile: (fileId: number) => void;
  onFinding: (id: number) => void;
};

function TaskCard({ task, paths, findings, onFile, onFinding }: TaskProps) {
  const status = taskStatus(task);

  return (
    <li className={cn("rounded-md border", status === UnitStatus.Running && "border-primary/40 bg-primary/5")}>
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <StatusIcon status={status} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
        </div>
        <span className="flex flex-wrap gap-1 pl-5.5">
          {task.fileIds.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onFile(id)}
              title={paths.get(id)}
              className="rounded bg-muted px-1.5 py-px font-mono text-[11px] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {splitPath(paths.get(id) ?? "?").name}
            </button>
          ))}
        </span>
        {task.focus && <p className="pl-5.5 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">{task.focus}</p>}
      </div>

      <ul className="border-t">
        {task.units.map((u) => (
          <ReviewerRow key={u.id} unit={u} findings={findings.filter((f) => f.unitId === u.id)} onFinding={onFinding} />
        ))}
      </ul>
    </li>
  );
}

type RowProps = {
  unit: UnitView;
  findings: Finding[];
  onFinding: (id: number) => void;
};

// One reviewer of a task: its role, live step, step log and findings.
function ReviewerRow({ unit, findings, onFinding }: RowProps) {
  const running = unit.status === UnitStatus.Running;
  const role = unit.agent ? `${unit.pass} agent` : `${unit.pass} check`;
  const hasDetails = unit.steps.length > 0 || findings.length > 0 || Boolean(unit.error);

  return (
    <li className="border-b last:border-b-0">
      <Collapsible>
        <CollapsibleTrigger
          disabled={!hasDetails}
          className="group flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:hover:bg-transparent"
        >
          <ChevronRight
            className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90", !hasDetails && "invisible")}
            aria-hidden
          />
          <StatusIcon status={unit.status} />
          <span className="flex shrink-0 items-center gap-1 font-medium" title={unit.agent ? "Explores the repository with tools" : "One model call"}>
            {unit.agent && <Bot className="size-3" aria-hidden />}
            {role}
          </span>
          <span className={cn("min-w-0 flex-1 truncate", running ? "text-primary" : "text-muted-foreground")} title={unit.activity ?? undefined}>
            {running ? (unit.activity ?? "Starting") : unit.status === UnitStatus.Pending ? "Queued" : unit.agent ? `${unit.steps.length} steps` : ""}
          </span>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {findings.length} {findings.length === 1 ? "finding" : "findings"}
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="flex flex-col gap-3 px-3 pt-1 pb-2.5 pl-12 text-xs">
            {unit.steps.length > 0 && (
              <Field label={`Steps (${unit.steps.length})`}>
                <ol className="flex flex-col gap-0.5">
                  {unit.steps.map((step, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-4 shrink-0 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                      <span className="min-w-0 break-words">{step}</span>
                    </li>
                  ))}
                </ol>
              </Field>
            )}

            {findings.length > 0 && (
              <Field label="Findings">
                <ul className="flex flex-col gap-0.5">
                  {findings.map((f) => (
                    <li key={f.id}>
                      <button type="button" onClick={() => onFinding(f.id)} className="text-left outline-none hover:underline focus-visible:underline">
                        <span className="text-muted-foreground">#{f.id}</span> {f.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </Field>
            )}

            {unit.error && <Field label="Error">{unit.error}</Field>}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 font-medium text-muted-foreground">{label}</p>
      <div className="leading-relaxed whitespace-pre-wrap">{children}</div>
    </div>
  );
}

function StatusIcon({ status }: { status: UnitStatus }) {
  if (status === UnitStatus.Running) {
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-label="Running" />;
  }

  if (status === UnitStatus.Pending) {
    return <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Queued" />;
  }

  if (status === UnitStatus.Failed) {
    return <AlertTriangle className="size-3.5 shrink-0 text-red-600 dark:text-red-400" aria-label="Failed" />;
  }

  return <Check className="size-3.5 shrink-0 text-green-700 dark:text-green-400" aria-label="Done" />;
}

const PILL_LABEL: Record<UnitStatus, string> = {
  [UnitStatus.Running]: "Working",
  [UnitStatus.Pending]: "Waiting",
  [UnitStatus.Done]: "Done",
  [UnitStatus.Failed]: "Failed",
};

function StatusPill({ status, label }: { status: UnitStatus; label?: string }) {
  return (
    <span
      className={cn(
        "flex max-w-[50%] shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs",
        status === UnitStatus.Running ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      <StatusIcon status={status} />
      <span className="truncate">{label ?? PILL_LABEL[status]}</span>
    </span>
  );
}
