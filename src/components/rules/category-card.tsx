"use client";

import { useOptimistic, useTransition } from "react";
import { ChevronRight, Pencil, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CategoryBadge } from "@/components/category-badge";
import { ConfirmButton } from "@/components/projects/confirm-button";
import { categoryClasses } from "@/lib/colors";
import { CategoryKind, isBuiltIn, Scope } from "@/lib/domain";
import {
  removeCategory,
  resetCategory,
  setCategoryDefault,
  toggleCategory,
  type CategoryView,
} from "@/app/rules/actions";
import { AddRulesForm } from "./add-rules-form";
import { CategoryDialog } from "./category-dialog";
import { RuleRow } from "./rule-row";

const KIND_LABELS: Record<CategoryKind, string | null> = {
  [CategoryKind.Bugs]: "Built-in · own pass",
  [CategoryKind.Language]: "Language pack",
  [CategoryKind.Custom]: null,
};

const MAX_GLOBS_SHOWN = 3;

type Props = {
  category: CategoryView;
  // Null on the global page.
  projectId: number | null;
};

// One category: header with on/off and actions, then its rules.
export function CategoryCard({ category: c, projectId }: Props) {
  const [enabled, setEnabled] = useOptimistic(c.enabled);
  const [, startTransition] = useTransition();

  // Global category seen from a project: on/off is a project override.
  const inherited = projectId !== null && c.scope === Scope.Global;
  const editable = !inherited;
  const globs = c.globs.split("\n").map((g) => g.trim()).filter(Boolean);
  const active = c.rules.filter((r) => r.enabled).length;

  function toggle(next: boolean) {
    startTransition(async () => {
      setEnabled(next);
      const result = inherited ? await toggleCategory(projectId, c.id, next) : await setCategoryDefault(c.id, next);
      if (result.error) {
        toast.error(result.error);
      }
    });
  }

  function followGlobal() {
    startTransition(async () => {
      const result = await resetCategory(projectId!, c.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(`${c.name} follows the global setting`);
    });
  }

  return (
    <Collapsible
      defaultOpen={c.enabled}
      id={`category-${c.id}`}
      className={cn("scroll-mt-16 overflow-hidden rounded-xl border border-l-4 bg-card", categoryClasses(c.color).border)}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        <CollapsibleTrigger
          aria-label={`Show rules of ${c.name}`}
          className="group -ml-1 flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronRight className="size-4 transition-transform group-data-panel-open:rotate-90" />
        </CollapsibleTrigger>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadge name={c.name} color={c.color} />
            <span className="text-xs text-muted-foreground">
              {[KIND_LABELS[c.kind], c.scope === Scope.Global ? "Global" : "This project"].filter(Boolean).join(" · ")}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">
              {globs.length === 0 ? "All files" : globs.slice(0, MAX_GLOBS_SHOWN).join("  ")}
              {globs.length > MAX_GLOBS_SHOWN && ` +${globs.length - MAX_GLOBS_SHOWN}`}
            </span>
            {c.description && ` · ${c.description}`}
          </p>
        </div>

        <span className="text-xs text-muted-foreground tabular-nums">
          {active}/{c.rules.length} rules
        </span>

        <div className="flex items-center gap-1">
          {inherited && (
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label="Follow global setting" onClick={followGlobal} className="text-muted-foreground" />}
              >
                <RotateCcw />
              </TooltipTrigger>
              <TooltipContent>Follow the global on/off setting</TooltipContent>
            </Tooltip>
          )}

          {editable && (
            <CategoryDialog
              category={c}
              projectId={projectId}
              trigger={<Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`} className="text-muted-foreground" />}
            >
              <Pencil />
            </CategoryDialog>
          )}

          {editable && !isBuiltIn(c.kind) && (
            <ConfirmButton
              label={`Delete ${c.name}`}
              title={`Delete ${c.name}?`}
              description={`Its ${c.rules.length} rules are deleted${c.scope === Scope.Global ? " for every project" : ""}.`}
              onConfirm={removeCategory.bind(null, c.id)}
            />
          )}

          <Switch
            className="ml-2"
            checked={enabled}
            onCheckedChange={toggle}
            aria-label={`${c.name} ${projectId === null ? "enabled by default" : "enabled in this project"}`}
          />
        </div>
      </header>

      <CollapsibleContent className={cn("border-t", !enabled && "opacity-60")}>
        {c.rules.length === 0 && <p className="px-4 pt-3 text-sm text-muted-foreground">No rules yet.</p>}

        <ul className="divide-y divide-border/60">
          {c.rules.map((r) => (
            <RuleRow key={r.id} rule={r} projectId={projectId} />
          ))}
        </ul>

        <AddRulesForm categoryId={c.id} projectId={projectId} />
      </CollapsibleContent>
    </Collapsible>
  );
}
