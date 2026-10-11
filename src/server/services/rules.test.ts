import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CATEGORY_COLORS, Severity } from "@/lib/domain";
import { formatRules } from "./review/prompts";

// Use a fresh migrated database to test rule storage and inheritance together.
beforeAll(() => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "prr-rules-"));
});

describe("named rules", () => {
  it("requires and trims both fields before storing a rule", async () => {
    const rules = await import("./rules");
    const categoryId = rules.createCategory(null, {
      name: "Tests", color: CATEGORY_COLORS[0], description: "", globs: "",
    });
    const input = { name: " Constants ", description: " Use named values. ", severity: Severity.Minor, enabled: true };

    expect(() => rules.addRules(categoryId, null, { ...input, name: " " })).toThrow();
    expect(() => rules.addRules(categoryId, null, { ...input, description: " " })).toThrow();
    expect(rules.addRules(categoryId, null, input)).toBe(1);
    const rule = rules.globalRules().find((c) => c.id === categoryId)!.rules[0];
    expect(rule).toMatchObject({ name: "Constants", description: "Use named values." });

    rules.editRule(rule.id, { ...input, name: "Named constants", description: "Explain meaningful values." });
    expect(rules.globalRules().find((c) => c.id === categoryId)!.rules[0]).toMatchObject({
      name: "Named constants", description: "Explain meaningful values.",
    });
  });

  it("overrides each field independently and freezes both for prompts", async () => {
    const rules = await import("./rules");
    const { insertProject } = await import("@/server/drivers/projectStore");
    const project = insertProject("App", "/named-rule-test");
    const categoryId = rules.createCategory(null, {
      name: "Overrides", color: CATEGORY_COLORS[0], description: "", globs: "",
    });
    rules.addRules(categoryId, null, {
      name: "Constants", description: "Use named values.", severity: Severity.Minor, enabled: true,
    });
    const category = rules.globalRules().find((c) => c.id === categoryId)!;
    const rule = category.rules[0];

    rules.overrideRule(project.id, rule.id, { name: "Project constants" });
    let effective = rules.effectiveRules(project.id).categories.find((c) => c.id === category.id)!;
    expect(effective.rules[0]).toMatchObject({ name: "Project constants", description: rule.description });

    rules.overrideRule(project.id, rule.id, { description: "Allow numeric test fixtures." });
    effective = rules.effectiveRules(project.id).categories.find((c) => c.id === category.id)!;
    expect(formatRules([effective])).toContain("Project constants: Allow numeric test fixtures.");
    expect(rules.globalRules().find((c) => c.id === category.id)!.rules[0]).toEqual(rule);

    rules.resetRule(project.id, rule.id);
    expect(rules.projectRules(project.id).find((c) => c.id === category.id)!.rules[0]).toMatchObject({
      name: rule.name, description: rule.description, overridden: false,
    });
  });
});
