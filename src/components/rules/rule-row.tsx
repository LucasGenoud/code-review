"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmButton } from "@/components/projects/confirm-button";
import { ruleKey, Scope, type Severity } from "@/lib/domain";
import { editRule, overrideRule, removeRule, resetRule, type RuleView } from "@/app/rules/actions";
import { SeveritySelect } from "./severity-select";

type Fields = Pick<RuleView, "text" | "severity" | "enabled">;

type Props = {
  rule: RuleView;
  // Null on the global page. Set: global rules get project overrides.
  projectId: number | null;
};

// One rule: on/off, severity, text (click to edit). On a project page,
// global rules are tweaked through overrides that can be reset.
export function RuleRow({ rule, projectId }: Props) {
  const [view, apply] = useOptimistic<Fields, Partial<Fields>>(rule, (cur, patch) => ({ ...cur, ...patch }));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rule.text);
  const [, startTransition] = useTransition();
  const closed = useRef(false);

  const overridable = projectId !== null && rule.scope === Scope.Global;
  const key = ruleKey(rule.id);

  // Global rule on a project page: store only the changed field as override.
  // Otherwise the rule itself is edited.
  function save(patch: Partial<Fields>) {
    startTransition(async () => {
      apply(patch);
      const result = overridable
        ? await overrideRule(projectId, rule.id, patch)
        : await editRule(rule.id, { ...view, ...patch });
      if (result.error) {
        toast.error(result.error);
      }
    });
  }

  function reset() {
    startTransition(async () => {
      const result = await resetRule(projectId!, rule.id);
      if (result.error) {
        toast.error(result.error);
      }
    });
  }

  function startEdit() {
    setDraft(view.text);
    closed.current = false;
    setEditing(true);
  }

  // Called on Enter and on blur; `closed` stops the second call and Esc.
  function commit() {
    if (closed.current) {
      return;
    }

    closed.current = true;
    setEditing(false);
    const text = draft.trim();
    if (!text || text === view.text) {
      return;
    }

    save({ text });
  }

  // Enter saves, Shift+Enter adds a line, Esc cancels.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      closed.current = true;
      setEditing(false);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commit();
    }
  }

  return (
    <li className={cn("group/rule flex items-start gap-3 px-4 py-2 hover:bg-muted/40", !view.enabled && "text-muted-foreground")}>
      <Switch
        size="sm"
        className="mt-1.5"
        checked={view.enabled}
        onCheckedChange={(enabled) => save({ enabled })}
        aria-label={`Enable rule ${key}`}
      />

      <SeveritySelect
        value={view.severity}
        onChange={(severity: Severity) => save({ severity })}
        label={`Severity of rule ${key}`}
        className={cn("h-6 w-[5.5rem] justify-between border-transparent px-1 hover:border-input dark:bg-transparent", !view.enabled && "opacity-60")}
      />

      <div className="min-w-0 flex-1 pt-0.5">
        {editing ? (
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commit}
            aria-label={`Text of rule ${key}`}
            className="min-h-0 py-1 text-sm"
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className={cn(
              "w-full cursor-text rounded-sm text-left text-sm leading-relaxed whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              !view.enabled && "line-through decoration-muted-foreground/40",
            )}
          >
            {view.text}
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        {rule.overridden && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="xs" onClick={reset} className="text-amber-700 dark:text-amber-400" />
              }
            >
              <RotateCcw />
              Overridden
            </TooltipTrigger>
            <TooltipContent>Changed for this project only. Click to reset to the global rule.</TooltipContent>
          </Tooltip>
        )}

        {projectId !== null && rule.scope === Scope.Project && (
          <span className="rounded px-1 text-[11px] text-muted-foreground ring-1 ring-border">This project</span>
        )}

        <span className="w-10 text-right font-mono text-[11px] text-muted-foreground/70">{key}</span>

        {overridable ? (
          <span className="size-7" aria-hidden />
        ) : (
          <div className="opacity-0 transition-opacity group-hover/rule:opacity-100 focus-within:opacity-100">
            <ConfirmButton
              label={`Delete rule ${key}`}
              title="Delete this rule?"
              description={view.text}
              onConfirm={removeRule.bind(null, rule.id)}
            />
          </div>
        )}
      </div>
    </li>
  );
}
