"use client";

import { Layers, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/projects/confirm-button";
import { removeRuleSet, saveRuleSet, type CategoryView, type RuleSetView } from "@/app/rules/actions";
import { Naming, RuleComposer } from "./rule-composer";

// Rule sets: named picks of rules. A project can default to one; a review
// can start from one and adjust it.
//
//   ┌ Rule sets ─────────────────────── [New rule set] ┐
//   │ Security audit   12 rules             ✎  🗑      │
//   └──────────────────────────────────────────────────┘

type Props = {
  sets: RuleSetView[];
  // Global categories and rules to compose from.
  categories: CategoryView[];
};

export function RuleSets({ sets, categories }: Props) {
  // Saves and reports; returns the error for the composer.
  async function save(id: number | null, ruleIds: number[], name: string) {
    const result = await saveRuleSet(id, { name, ruleIds });
    if (result.error !== undefined) {
      return result.error;
    }

    toast.success(id === null ? `Created ${name}` : "Rule set saved");
    return null;
  }

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>
            <h2>Rule sets</h2>
          </CardTitle>
          <CardDescription>
            Named picks of rules. Set one as a project&apos;s default, or pick one when starting a review.
          </CardDescription>
        </div>
        <RuleComposer
          title="New rule set"
          description="Choose the rules a review with this set runs."
          categories={categories}
          initial={[]}
          naming={Naming.Required}
          submitLabel="Create"
          onSubmit={(ids, name) => save(null, ids, name)}
          trigger={<Button variant="outline" size="sm" />}
        >
          <Plus />
          New rule set
        </RuleComposer>
      </CardHeader>

      {sets.length > 0 && (
        <CardContent>
          <ul className="divide-y rounded-lg border">
            {sets.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2">
                <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {s.ruleIds.length} {s.ruleIds.length === 1 ? "rule" : "rules"}
                </span>
                <RuleComposer
                  title={`Edit ${s.name}`}
                  description="Choose the rules a review with this set runs."
                  categories={categories}
                  initial={s.ruleIds}
                  initialName={s.name}
                  naming={Naming.Required}
                  submitLabel="Save"
                  onSubmit={(ids, name) => save(s.id, ids, name)}
                  trigger={<Button variant="ghost" size="icon-sm" aria-label={`Edit ${s.name}`} className="text-muted-foreground" />}
                >
                  <Pencil />
                </RuleComposer>
                <ConfirmButton
                  label={`Delete ${s.name}`}
                  title={`Delete ${s.name}?`}
                  description="Its rules stay; only this selection is deleted. Projects using it as default fall back to their switched-on rules."
                  onConfirm={removeRuleSet.bind(null, s.id)}
                />
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
