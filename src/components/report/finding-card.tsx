"use client";

import { useState } from "react";
import { Check, CircleSlash, Clock, FlaskConical, Loader2, MessageSquare, RotateCcw, Wand2, X, Zap } from "lucide-react";
import { cn } from "cn";
import type { Finding } from "@/app/reviews/actions";
import { CategoryBadge } from "@/components/category-badge";
import { SeverityBadge } from "@/components/severity-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { categoryClasses } from "@/lib/colors";
import { CategoryKind, FindingStatus, ruleKey } from "@/lib/domain";
import { useReport } from "./report-context";
import { findingAnchor } from "./report-lib";

// Inline finding cards shown under the finding's last line in the diff.
//
//   ┃ [Bugs] [MAJOR] R1 · likely                 #12
//   ┃ Title
//   ┃ Explanation, failure scenario, suggested fix
//   ┃ [Apply fix] [Dismiss] [Ask]

const CLOSED: Record<Exclude<FindingStatus, FindingStatus.Open>, { label: string; icon: typeof Check }> = {
  [FindingStatus.Dismissed]: { label: "Dismissed", icon: CircleSlash },
  [FindingStatus.Fixed]: { label: "Fixed", icon: Check },
  [FindingStatus.Outdated]: { label: "Outdated", icon: Clock },
};

export function FindingStack({ findings }: { findings: Finding[] }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-2 font-sans text-sm whitespace-normal">
      {findings.map((f) =>
        f.status === FindingStatus.Open ? <OpenFinding key={f.id} finding={f} /> : <ClosedFinding key={f.id} finding={f} />,
      )}
    </div>
  );
}

function OpenFinding({ finding: f }: { finding: Finding }) {
  const ctx = useReport();
  const pending = ctx.busy.includes(f.id);

  return (
    <article
      id={findingAnchor(f.id)}
      aria-label={`Finding #${f.id}: ${f.title}`}
      className={cardClass(f, ctx.categories.get(f.categoryId)?.color, ctx.selectedId, ctx.flashId)}
    >
      <FindingHead finding={f} />
      <FindingBody finding={f} />

      <footer className="flex items-center gap-1 border-t px-2 py-1.5">
        {f.replacement !== null && (
          <Button size="xs" onClick={() => ctx.apply(f.id)} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Wand2 />}
            Apply fix
          </Button>
        )}
        <DismissButton finding={f} disabled={pending} />
        <Button size="xs" variant="ghost" onClick={() => ctx.ask(f)}>
          <MessageSquare />
          Ask
        </Button>
        {ctx.canVerify && ctx.categories.get(f.categoryId)?.kind === CategoryKind.Bugs && (
          <Button size="xs" variant="ghost" onClick={() => ctx.verify(f)}>
            <FlaskConical />
            Verify in sandbox
          </Button>
        )}
      </footer>
    </article>
  );
}

// Dismissed, fixed or outdated: one muted line, expandable.
function ClosedFinding({ finding: f }: { finding: Finding }) {
  const ctx = useReport();
  const [expanded, setExpanded] = useState(false);
  const { label, icon: Icon } = CLOSED[f.status as keyof typeof CLOSED];
  const pending = ctx.busy.includes(f.id);

  return (
    <article
      id={findingAnchor(f.id)}
      aria-label={`${label} finding #${f.id}: ${f.title}`}
      className={cn(cardClass(f, ctx.categories.get(f.categoryId)?.color, ctx.selectedId, ctx.flashId), "border-dashed bg-muted/30 shadow-none")}
    >
      <div className="flex min-h-9 items-center gap-2 px-2.5 py-1 text-xs text-muted-foreground">
        {pending ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <Icon className="size-3.5 shrink-0" />}
        <span className="shrink-0 font-medium text-foreground/80">{label}</span>
        <span className="min-w-0 truncate">{f.title}</span>
        {f.status === FindingStatus.Dismissed && f.dismissReason && (
          <span className="hidden min-w-0 truncate italic md:inline">“{f.dismissReason}”</span>
        )}
        {f.status === FindingStatus.Outdated && (
          <span className="hidden shrink-0 md:inline">Code changed since review — refresh or re-review</span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {f.status === FindingStatus.Fixed && ctx.undoableFixes.includes(f.id) && (
            <Button size="xs" variant="ghost" onClick={() => ctx.undo(f.id)} disabled={pending}>
              <RotateCcw />
              Undo fix
            </Button>
          )}
          {f.status === FindingStatus.Dismissed && (
            <Button size="xs" variant="ghost" onClick={() => ctx.reopen(f.id)} disabled={pending}>
              <RotateCcw />
              Reopen
            </Button>
          )}
          <Button size="xs" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? "Hide" : "Show"}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t opacity-80">
          {f.dismissReason && (
            <p className="px-3 pt-2 text-xs text-muted-foreground">
              <span className="font-medium">Dismissed because:</span> {f.dismissReason}
            </p>
          )}
          <FindingHead finding={f} />
          <FindingBody finding={f} />
        </div>
      )}
    </article>
  );
}

function cardClass(f: Finding, color: string | undefined, selectedId: number | null, flashId: number | null): string {
  return cn(
    "scroll-my-24 overflow-hidden rounded-md border border-l-[3px] bg-card text-card-foreground shadow-xs transition-shadow",
    categoryClasses(color ?? "slate").border,
    selectedId === f.id && "ring-2 ring-ring/40",
    flashId === f.id && "finding-flash",
  );
}

// Category, severity, rule key (rule text on hover), confidence, id.
function FindingHead({ finding: f }: { finding: Finding }) {
  const ctx = useReport();
  const category = ctx.categories.get(f.categoryId);
  const ruleText = ctx.rules.get(f.ruleId) ?? "Rule no longer in the snapshot";

  return (
    <header className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
      {category && <CategoryBadge name={category.name} color={category.color} />}
      <SeverityBadge severity={f.severity} />
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              tabIndex={0}
              className="cursor-help rounded px-1 font-mono text-[11px] text-muted-foreground ring-1 ring-border outline-none focus-visible:ring-ring"
            />
          }
        >
          {ruleKey(f.ruleId)}
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">{ruleText}</TooltipContent>
      </Tooltip>
      {f.confidence && <span className="text-[11px] text-muted-foreground">{f.confidence}</span>}
      <span className="ml-auto font-mono text-[11px] text-muted-foreground">#{f.id}</span>
    </header>
  );
}

function FindingBody({ finding: f }: { finding: Finding }) {
  return (
    <div className="flex flex-col gap-2 px-3 pt-1.5 pb-3">
      <h3 className="leading-snug font-medium">{f.title}</h3>
      <p className="leading-relaxed whitespace-pre-wrap text-muted-foreground">{f.explanation}</p>

      {f.failure && (
        <div className="flex gap-2 rounded-md bg-red-500/5 px-2.5 py-2 text-[13px] ring-1 ring-red-500/15 ring-inset">
          <Zap className="mt-0.5 size-3.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
          <p>
            <span className="font-medium">Failure scenario: </span>
            {f.failure}
          </p>
        </div>
      )}

      {f.replacement !== null && <FixPreview quote={f.quote} replacement={f.replacement} />}
    </div>
  );
}

// Mini before/after of the suggested fix.
function FixPreview({ quote, replacement }: { quote: string; replacement: string }) {
  return (
    <figure className="overflow-hidden rounded-md border">
      <figcaption className="border-b bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
        Suggested fix
      </figcaption>
      <div className="overflow-x-auto font-mono text-xs leading-5">
        <FixLines text={quote} sign="-" className="bg-red-500/10 text-red-900 dark:text-red-200" />
        {replacement === "" ? (
          <div className="px-2.5 text-muted-foreground italic">(remove these lines)</div>
        ) : (
          <FixLines text={replacement} sign="+" className="bg-green-500/10 text-green-900 dark:text-green-200" />
        )}
      </div>
    </figure>
  );
}

function FixLines({ text, sign, className }: { text: string; sign: string; className: string }) {
  return (
    <div className={className}>
      {text.split("\n").map((line, i) => (
        <div key={i} className="flex px-2.5 whitespace-pre">
          <span className="mr-2 w-2 shrink-0 opacity-60 select-none" aria-hidden>
            {sign}
          </span>
          {line || " "}
        </div>
      ))}
    </div>
  );
}

// Dismiss with an optional reason. Enter submits, Shift+Enter adds a line.
function DismissButton({ finding, disabled }: { finding: Finding; disabled: boolean }) {
  const ctx = useReport();
  const [reason, setReason] = useState("");
  const open = ctx.dismissingId === finding.id;
  const inputId = `dismiss-${finding.id}`;

  function submit() {
    ctx.dismiss(finding.id, reason);
    ctx.setDismissingId(null);
    setReason("");
  }

  return (
    <Popover open={open} onOpenChange={(next) => ctx.setDismissingId(next ? finding.id : null)}>
      <PopoverTrigger render={<Button size="xs" variant="ghost" disabled={disabled} />}>
        <X />
        Dismiss
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Label htmlFor={inputId}>
            Why dismiss? <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id={inputId}
            autoFocus
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Input is validated by the caller"
            className="min-h-16 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <p className="text-xs text-muted-foreground">Reasons help refine your rules. Enter to dismiss.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => ctx.setDismissingId(null)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Dismiss
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
