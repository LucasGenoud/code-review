"use client";

import { useState } from "react";
import { Bot, ChevronRight, Clock, Compass, Loader2 } from "lucide-react";
import type { OrchestratorView, ReviewFile, UnitView } from "@/app/reviews/actions";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { UnitStatus } from "@/lib/domain";
import { fileAnchor, isFinished, unitName } from "./report-lib";

// What a running review is doing, under the report header:
//
//   ◎ Orchestrator: Waiting for 4 reviewers                    [Agents]
//   ⟳ Now reviewing 2 · 12/40 done                          ▸ Up next (26)
//     [Bugs]  Refund flow · pay.ts, invoice.ts      Reading money.ts:1-80
//     [Rules] handler.ts                            Waiting for the model

// Queued units listed when expanded; the rest are counted.
const QUEUE_SHOWN = 30;

type Props = {
  units: UnitView[];
  files: ReviewFile[];
  orchestrator: OrchestratorView;
  onOpenAgents: () => void;
};

export function LiveActivity({ units, files, orchestrator, onOpenAgents }: Props) {
  const [queueOpen, setQueueOpen] = useState(false);
  const paths = new Map(files.map((f) => [f.id, f.path]));
  const running = units.filter((u) => u.status === UnitStatus.Running);
  const queued = units.filter((u) => u.status === UnitStatus.Pending);
  const done = units.filter(isFinished).length;

  const lead = (
    <div className="flex items-center gap-2 px-4 pt-2 text-xs">
      <Compass className="size-3.5 shrink-0 text-primary" aria-hidden />
      <span className="font-medium">Orchestrator</span>
      <span className="min-w-0 truncate text-muted-foreground">
        {orchestrator.activity ?? (units.length === 0 ? "Planning the review…" : running.length + queued.length > 0 ? "Reviewers at work" : "Writing the review summary…")}
      </span>
      <Button size="xs" variant="ghost" className="ml-auto shrink-0" onClick={onOpenAgents}>
        <Bot />
        Agents
      </Button>
    </div>
  );

  if (running.length === 0 && queued.length === 0) {
    return (
      <div className="border-b bg-muted/30 pb-2" aria-live="polite" aria-label="Review activity">
        {lead}
      </div>
    );
  }

  return (
    <div className="border-b bg-muted/30 text-xs" aria-live="polite" aria-label="Review activity">
      {lead}
      <Collapsible open={queueOpen} onOpenChange={setQueueOpen}>
        <div className="flex items-center gap-2 px-4 pt-2">
          <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
          <span className="font-medium">Now reviewing {running.length}</span>
          <span className="text-muted-foreground tabular-nums">
            · {done}/{units.length} done
          </span>
          {queued.length > 0 && (
            <CollapsibleTrigger className="group ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
              <ChevronRight className="size-3.5 transition-transform group-data-panel-open:rotate-90" aria-hidden />
              Up next ({queued.length})
            </CollapsibleTrigger>
          )}
        </div>

        <ul className="flex flex-col gap-0.5 px-4 pt-1 pb-2">
          {running.map((u) => (
            <UnitRow key={u.id} unit={u} paths={paths} />
          ))}
        </ul>

        <CollapsibleContent>
          <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto border-t px-4 py-2">
            {queued.slice(0, QUEUE_SHOWN).map((u, i) => (
              <UnitRow key={u.id} unit={u} paths={paths} position={i + 1} />
            ))}
            {queued.length > QUEUE_SHOWN && (
              <li className="pl-6 text-muted-foreground">+ {queued.length - QUEUE_SHOWN} more</li>
            )}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// position: place in the queue; absent for running units.
function UnitRow({ unit, paths, position }: { unit: UnitView; paths: Map<number, string>; position?: number }) {
  const names = unit.fileIds.map((id) => paths.get(id) ?? "?");
  const queued = position !== undefined;

  return (
    <li className="flex min-w-0 items-center gap-2">
      {queued ? (
        <span className="w-4 shrink-0 text-right text-muted-foreground tabular-nums">{position}</span>
      ) : (
        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden />
      )}
      <span className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-px text-[11px] font-medium">
        {unit.agent && <Bot className="size-3" aria-hidden />}
        {unit.pass}
      </span>
      <button
        type="button"
        title={[unit.focus, ...names].filter(Boolean).join("\n")}
        onClick={() => document.getElementById(fileAnchor(unit.fileIds[0]))?.scrollIntoView({ behavior: "smooth", block: "start" })}
        className="min-w-0 truncate text-left outline-none hover:underline focus-visible:underline"
      >
        <span className="font-medium">{unitName(unit, paths)}</span>
        {unit.title && <span className="text-muted-foreground"> · {names.map(baseName).join(", ")}</span>}
      </button>
      {queued ? (
        <Clock className="ml-auto size-3 shrink-0 text-muted-foreground" aria-label="Queued" />
      ) : (
        <span className="ml-auto max-w-[45%] truncate pl-2 text-muted-foreground" title={unit.activity ?? undefined}>
          {unit.activity ?? "Waiting for the model"}
        </span>
      )}
    </li>
  );
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
