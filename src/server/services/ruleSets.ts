import { z } from "zod";
import {
  allRuleSets,
  deleteRuleSet,
  insertRuleSet,
  ruleSetById,
  updateRuleSet,
} from "@/server/drivers/ruleSetStore";
import { allRuleIds } from "@/server/drivers/ruleStore";
import { InputError } from "./errors";

// Rule sets: named picks of rules, e.g. "Security audit" = { R10, R12, … }.
// A project can default to one; a review can start from one and adjust it.
// Project-only rules in a set apply in their project only.

export type RuleSetView = { id: number; name: string; ruleIds: number[] };

const ruleSetSchema = z.object({
  name: z.string().trim().min(1),
  ruleIds: z.array(z.number().int()).min(1),
});

export type RuleSetInput = z.input<typeof ruleSetSchema>;

// Deleted rules drop out of the views.
export function listRuleSets(): RuleSetView[] {
  const known = allRuleIds();
  return allRuleSets().map((s) => ({ id: s.id, name: s.name, ruleIds: parseIds(s.ruleIds).filter((id) => known.has(id)) }));
}

// id null = new set. Returns the set's id.
export function saveRuleSet(id: number | null, input: RuleSetInput): number {
  const parsed = ruleSetSchema.parse(input);
  const known = allRuleIds();
  if (parsed.ruleIds.some((r) => !known.has(r))) {
    throw new InputError("Unknown rule in set");
  }

  const set = { name: parsed.name, ruleIds: [...new Set(parsed.ruleIds)] };
  if (id === null) {
    return insertRuleSet(set).id;
  }

  requireRuleSet(id);
  updateRuleSet(id, set);
  return id;
}

export function removeRuleSet(id: number): void {
  requireRuleSet(id);
  deleteRuleSet(id);
}

export function requireRuleSet(id: number) {
  const set = ruleSetById(id);
  if (!set) {
    throw new InputError("Unknown rule set");
  }

  return set;
}

function parseIds(json: string): number[] {
  return JSON.parse(json) as number[];
}
