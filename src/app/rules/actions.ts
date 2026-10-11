"use server";

import { connection } from "next/server";
import { refresh } from "next/cache";
import type { ChangeScope, Severity } from "@/lib/domain";
import * as changes from "@/server/services/ruleChanges";
import * as rules from "@/server/services/rules";
import { attempt } from "../result";

// Rules API: global categories and rules, per-project overrides, and the
// LLM-proposed rule change list.

export type { CategoryInput, CategoryView, RuleInput, RuleView } from "@/server/services/rules";
export type { ChangeView } from "@/server/services/ruleChanges";

export async function globalRules() {
  await connection();
  return rules.globalRules();
}

export async function projectRules(projectId: number) {
  await connection();
  return rules.projectRules(projectId);
}

// projectId null = global category.
export async function createCategory(projectId: number | null, input: rules.CategoryInput) {
  const result = await attempt(() => rules.createCategory(projectId, input));
  refresh();
  return result;
}

export async function editCategory(id: number, input: rules.CategoryInput) {
  const result = await attempt(() => rules.editCategory(id, input));
  refresh();
  return result;
}

export async function removeCategory(id: number) {
  const result = await attempt(() => rules.removeCategory(id));
  refresh();
  return result;
}

// Global default on/off for a category.
export async function setCategoryDefault(id: number, enabled: boolean) {
  const result = await attempt(() => rules.setCategoryDefault(id, enabled));
  refresh();
  return result;
}

// Project-only on/off for a category.
export async function toggleCategory(projectId: number, id: number, enabled: boolean) {
  const result = await attempt(() => rules.toggleCategory(projectId, id, enabled));
  refresh();
  return result;
}

export async function resetCategory(projectId: number, id: number) {
  const result = await attempt(() => rules.resetCategory(projectId, id));
  refresh();
  return result;
}

// A rule requires a name and description.
// projectId set = rules only for that project.
export async function addRules(categoryId: number, projectId: number | null, input: rules.RuleInput | rules.RuleInput[]) {
  const result = await attempt(() => rules.addRules(categoryId, projectId, input));
  refresh();
  return result;
}

export async function editRule(id: number, input: rules.RuleInput) {
  const result = await attempt(() => rules.editRule(id, input));
  refresh();
  return result;
}

export async function removeRule(id: number) {
  const result = await attempt(() => rules.removeRule(id));
  refresh();
  return result;
}

// Project tweak of a global rule. Null fields inherit the global value.
export async function overrideRule(
  projectId: number,
  ruleId: number,
  patch: { name?: string | null; description?: string | null; severity?: Severity | null; enabled?: boolean | null },
) {
  const result = await attempt(() => rules.overrideRule(projectId, ruleId, patch));
  refresh();
  return result;
}

export async function resetRule(projectId: number, ruleId: number) {
  const result = await attempt(() => rules.resetRule(projectId, ruleId));
  refresh();
  return result;
}

export async function listChanges(projectId: number) {
  await connection();
  return changes.listChanges(projectId);
}

// Asks the LLM for rule changes from dismissed findings. Takes seconds.
export async function generateChanges(projectId: number) {
  const result = await attempt(() => changes.generateChanges(projectId));
  refresh();
  return result;
}

export async function acceptChange(id: number, scope: ChangeScope) {
  const result = await attempt(() => changes.acceptChange(id, scope));
  refresh();
  return result;
}

export async function rejectChange(id: number) {
  const result = await attempt(() => changes.rejectChange(id));
  refresh();
  return result;
}
