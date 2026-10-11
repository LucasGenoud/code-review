"use client";

import { useOptimistic, useTransition } from "react";
import { ArrowRight, Check, Globe, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CategoryBadge } from "@/components/category-badge";
import { SeverityBadge } from "@/components/severity-badge";
import { ChangeKind, ChangeScope, ruleKey } from "@/lib/domain";
import { acceptChange, generateChanges, rejectChange, type ChangeView } from "@/app/rules/actions";

const KIND_LABELS: Record<ChangeKind, string> = {
  [ChangeKind.Add]: "New rule",
  [ChangeKind.Edit]: "Reword rule",
  [ChangeKind.Disable]: "Disable rule",
  [ChangeKind.Severity]: "Change severity",
};

// Rule changes the model proposed from dismissed findings. Handled
// changes disappear right away; a failed action brings them back.
export function ChangeList({ changes }: { changes: ChangeView[] }) {
  const [visible, hide] = useOptimistic(changes, (list, id: number) => list.filter((c) => c.id !== id));

  if (visible.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
      <header>
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-violet-500" />
          Suggested rule changes ({visible.length})
        </h2>
        <p className="text-xs text-muted-foreground">Learned from findings you dismissed. Accept to apply to this project.</p>
      </header>

      <ul className="flex flex-col gap-2">
        {visible.map((c) => (
          <ChangeRow key={c.id} change={c} hide={hide} />
        ))}
      </ul>
    </section>
  );
}

function ChangeRow({ change: c, hide }: { change: ChangeView; hide: (id: number) => void }) {
  const [pending, startTransition] = useTransition();
  const promotable = c.globalRule || c.kind === ChangeKind.Add;

  function run(action: () => Promise<{ error?: string }>, done: string) {
    startTransition(async () => {
      hide(c.id);
      const result = await action();
      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(done);
    });
  }

  const findings = c.findingIds.length;

  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{KIND_LABELS[c.kind]}</span>
        {c.categoryName && c.categoryColor && <CategoryBadge name={c.categoryName} color={c.categoryColor} />}
        {c.ruleId !== null && <span className="font-mono text-muted-foreground">{ruleKey(c.ruleId)}</span>}
        <span className="ml-auto text-muted-foreground">
          from {findings} dismissed {findings === 1 ? "finding" : "findings"}
        </span>
      </div>

      <ChangeDiff change={c} />

      <p className="text-xs text-muted-foreground">{c.rationale}</p>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => rejectChange(c.id), "Change rejected")}>
          <X />
          Reject
        </Button>
        {promotable && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run(() => acceptChange(c.id, ChangeScope.Global), "Applied to all projects")}
          >
            <Globe />
            Accept for all projects
          </Button>
        )}
        <Button size="sm" disabled={pending} onClick={() => run(() => acceptChange(c.id, ChangeScope.Project), "Applied to this project")}>
          {pending ? <Loader2 className="animate-spin" /> : <Check />}
          Accept
        </Button>
      </div>
    </li>
  );
}

// Before → after. Old values struck through, new ones highlighted.
function ChangeDiff({ change: c }: { change: ChangeView }) {
  const textChanged = c.kind === ChangeKind.Edit || c.kind === ChangeKind.Disable;
  const before = c.ruleText ?? "(rule no longer exists)";

  return (
    <div className="flex flex-col gap-1 text-sm">
      {c.kind !== ChangeKind.Add && (
        <p className={textChanged ? "rounded bg-red-500/10 px-2 py-1 text-muted-foreground line-through" : "px-2 py-1"}>
          {c.ruleSeverity && <SeverityBadge severity={c.ruleSeverity} className="mr-2 align-middle" />}
          {before}
        </p>
      )}

      {c.kind === ChangeKind.Severity && c.ruleSeverity && c.severity && (
        <p className="flex items-center gap-2 px-2 text-xs">
          <SeverityBadge severity={c.ruleSeverity} className="line-through opacity-60" />
          <ArrowRight className="size-3.5 text-muted-foreground" />
          <SeverityBadge severity={c.severity} />
        </p>
      )}

      {(c.kind === ChangeKind.Add || c.kind === ChangeKind.Edit) && (
        <p className="rounded bg-green-500/10 px-2 py-1">
          {c.severity && <SeverityBadge severity={c.severity} className="mr-2 align-middle" />}
          {c.text}
        </p>
      )}
    </div>
  );
}

// Asks the model for rule changes from new dismissals. Takes seconds.
export function LearnButton({ projectId }: { projectId: number }) {
  const [pending, startTransition] = useTransition();

  function learn() {
    startTransition(async () => {
      const result = await generateChanges(projectId);
      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(result.data === 0 ? "No rule changes suggested" : `${result.data} rule ${result.data === 1 ? "change" : "changes"} suggested`);
    });
  }

  return (
    <Button variant="outline" onClick={learn} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
      {pending ? "Learning…" : "Learn from dismissals"}
    </Button>
  );
}
