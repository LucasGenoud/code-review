import { asc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { ruleSets, type RuleSet } from "./schema";

export type RuleSetInput = { name: string; ruleIds: number[] };

export function allRuleSets(): RuleSet[] {
  return getDb().select().from(ruleSets).orderBy(asc(ruleSets.name), asc(ruleSets.id)).all();
}

export function ruleSetById(id: number): RuleSet | undefined {
  return getDb().select().from(ruleSets).where(eq(ruleSets.id, id)).get();
}

export function insertRuleSet(input: RuleSetInput): RuleSet {
  return getDb()
    .insert(ruleSets)
    .values({ name: input.name, ruleIds: JSON.stringify(input.ruleIds) })
    .returning()
    .get();
}

export function updateRuleSet(id: number, input: RuleSetInput): void {
  getDb()
    .update(ruleSets)
    .set({ name: input.name, ruleIds: JSON.stringify(input.ruleIds) })
    .where(eq(ruleSets.id, id))
    .run();
}

export function deleteRuleSet(id: number): void {
  getDb().delete(ruleSets).where(eq(ruleSets.id, id)).run();
}
