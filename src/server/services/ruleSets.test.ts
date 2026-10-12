import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import { CATEGORY_COLORS, Severity } from "@/lib/domain";

beforeAll(() => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "prr-sets-"));
});

it("reviews exactly the picked rules, switched off or not, with overrides", async () => {
  const rules = await import("./rules");
  const sets = await import("./ruleSets");
  const { insertProject } = await import("@/server/drivers/projectStore");
  const project = insertProject("App", "/app");

  // Category switched off, one of its rules switched off too.
  const categoryId = rules.createCategory(null, { name: "Audit", color: CATEGORY_COLORS[0], description: "", globs: "" });
  rules.setCategoryDefault(categoryId, false);
  rules.addRules(categoryId, null, [
    { name: "Picked", description: "Kept.", severity: Severity.Minor, enabled: false },
    { name: "Left out", description: "Skipped.", severity: Severity.Minor, enabled: true },
  ]);
  const [picked] = rules.globalRules().find((c) => c.id === categoryId)!.rules;
  rules.overrideRule(project.id, picked.id, { severity: Severity.Critical });

  const id = sets.saveRuleSet(null, { name: " Audit only ", ruleIds: [picked.id, picked.id] });
  expect(sets.listRuleSets()).toEqual([{ id, name: "Audit only", ruleIds: [picked.id] }]);

  const snapshot = rules.effectiveRules(project.id, new Set(sets.listRuleSets()[0].ruleIds));
  expect(snapshot.categories).toHaveLength(1);
  expect(snapshot.categories[0].rules).toEqual([{ id: picked.id, name: "Picked", description: "Kept.", severity: Severity.Critical }]);

  // Deleted rules drop out of the set.
  rules.removeRule(picked.id);
  expect(sets.listRuleSets()[0].ruleIds).toEqual([]);
});

it("rejects empty sets and unknown rules", async () => {
  const sets = await import("./ruleSets");
  expect(() => sets.saveRuleSet(null, { name: "Empty", ruleIds: [] })).toThrow();
  expect(() => sets.saveRuleSet(null, { name: "Ghost", ruleIds: [999_999] })).toThrow("Unknown rule in set");
});

it("keeps a project's default set valid and clears it when the set is deleted", async () => {
  const rules = await import("./rules");
  const sets = await import("./ruleSets");
  const projects = await import("./projects");
  const { insertProject } = await import("@/server/drivers/projectStore");
  const project = insertProject("Defaults", "/defaults");
  const ruleId = rules.globalRules()[0].rules[0].id;
  const id = sets.saveRuleSet(null, { name: "Quick", ruleIds: [ruleId] });
  const base = { description: "", ignoreGlobs: "", modelId: null };

  expect(() => projects.saveProjectSettings(project.id, { ...base, ruleSetId: 999_999 })).toThrow("Unknown rule set");
  projects.saveProjectSettings(project.id, { ...base, ruleSetId: id });
  expect(projects.getProject(project.id).ruleSetId).toBe(id);

  // Saving without the field (e.g. description only) keeps it.
  projects.saveProjectSettings(project.id, base);
  expect(projects.getProject(project.id).ruleSetId).toBe(id);

  sets.removeRuleSet(id);
  expect(projects.getProject(project.id).ruleSetId).toBeNull();
});
