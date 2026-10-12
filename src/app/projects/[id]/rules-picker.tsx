"use client";

import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ModelSelect } from "@/components/settings/model-select";
import { Naming, RuleComposer } from "@/components/rules/rule-composer";
import { saveRuleSet, type CategoryView, type RuleSetView } from "@/app/rules/actions";

// Rules for one review: switched-on rules, a rule set, or a custom pick
// made here (starts from the current choice).
//
//   Rules [Security audit · default ▾] [Customize]  12 rules

// Select entry for a custom pick; real ids are positive.
const CUSTOM = -1;

// setId null = switched-on rules. custom set = picked for this review only.
export type RulesChoice = { setId: number | null; custom: number[] | null };

type Props = {
  value: RulesChoice;
  onChange: (value: RulesChoice) => void;
  ruleSets: RuleSetView[];
  // The project's rules, overrides applied.
  categories: CategoryView[];
  defaultSetId: number | null;
};

// Rule ids a choice reviews; null = switched-on rules.
export function choiceRuleIds(choice: RulesChoice, ruleSets: RuleSetView[]): number[] | null {
  if (choice.custom) {
    return choice.custom;
  }

  return ruleSets.find((s) => s.id === choice.setId)?.ruleIds ?? null;
}

export function RulesPicker({ value, onChange, ruleSets, categories, defaultSetId }: Props) {
  const onIds = categories.flatMap((c) => (c.enabled ? c.rules.filter((r) => r.enabled).map((r) => r.id) : []));
  const projectIds = new Set(categories.flatMap((c) => c.rules.map((r) => r.id)));
  const picked = choiceRuleIds(value, ruleSets);
  // Rules of other projects in a set don't apply here.
  const count = picked ? picked.filter((id) => projectIds.has(id)).length : onIds.length;

  const options = [
    ...ruleSets.map((s) => ({ id: s.id, label: s.id === defaultSetId ? `${s.name} · default` : s.name })),
    ...(value.custom ? [{ id: CUSTOM, label: "Custom pick" }] : []),
  ];

  async function customize(ids: number[], name: string) {
    if (!name) {
      onChange({ setId: value.setId, custom: ids });
      return null;
    }

    const result = await saveRuleSet(null, { name, ruleIds: ids });
    if (result.error !== undefined) {
      return result.error;
    }

    onChange({ setId: result.data, custom: null });
    toast.success(`Created ${name}`);
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor="review-rules" className="text-xs text-muted-foreground">Rules</Label>
      <ModelSelect
        id="review-rules"
        models={options}
        value={value.custom ? CUSTOM : value.setId}
        onChange={(id) => id !== CUSTOM && onChange({ setId: id, custom: null })}
        nullLabel={defaultSetId === null ? "Switched-on rules · default" : "Switched-on rules"}
        className="w-60"
      />
      <RuleComposer
        title="Rules for this review"
        description="Starts from the current choice. Add a name to also save it as a rule set."
        categories={categories}
        initial={picked ?? onIds}
        naming={Naming.Optional}
        submitLabel="Use for this review"
        onSubmit={customize}
        trigger={<Button type="button" variant="outline" size="sm" />}
      >
        <SlidersHorizontal />
        Customize
      </RuleComposer>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count} {count === 1 ? "rule" : "rules"}
      </span>
    </div>
  );
}
