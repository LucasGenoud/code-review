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
  it("validates a whole batch before storing any rules", async () => {
    const rules = await import("./rules");
    const categoryId = rules.createCategory(null, {
      name: "Batch", color: CATEGORY_COLORS[0], description: "", globs: "",
    });
    const first = { name: " Constants ", description: " Use named values. ", severity: Severity.Minor, enabled: true };
    const second = { ...first, name: "Types", description: "Avoid implicit any.", severity: Severity.Major };

    expect(() => rules.addRules(categoryId, null, [first, { ...second, description: " " }])).toThrow();
    expect(rules.globalRules().find((c) => c.id === categoryId)!.rules).toHaveLength(0);
    expect(() => rules.addRules(categoryId, null, [])).toThrow();
    expect(rules.addRules(categoryId, null, [first, second])).toBe(2);
    expect(rules.globalRules().find((c) => c.id === categoryId)!.rules).toMatchObject([
      { name: "Constants", description: "Use named values.", severity: Severity.Minor },
      { name: "Types", description: "Avoid implicit any.", severity: Severity.Major },
    ]);
  });

  it("keeps a batch local to its project and checks category ownership", async () => {
    const rules = await import("./rules");
    const { insertProject } = await import("@/server/drivers/projectStore");
    const project = insertProject("Batch app", "/batch-rule-test");
    const categoryId = rules.createCategory(null, {
      name: "Project batch", color: CATEGORY_COLORS[0], description: "", globs: "",
    });
    const input = { name: "Constants", description: "Use named values.", severity: Severity.Minor, enabled: true };

    rules.addRules(categoryId, project.id, [input, { ...input, name: "Types" }]);
    expect(rules.globalRules().find((c) => c.id === categoryId)!.rules).toHaveLength(0);
    expect(rules.projectRules(project.id).find((c) => c.id === categoryId)!.rules).toHaveLength(2);

    const localId = rules.createCategory(project.id, {
      name: "Local", color: CATEGORY_COLORS[0], description: "", globs: "",
    });
    expect(() => rules.addRules(localId, null, [input])).toThrow("Category belongs to another project");
  });

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

describe("rules export and import", () => {
  it("adds unknown categories and rules, keeps known ones", async () => {
    const rules = await import("./rules");
    const file = rules.exportRules();
    const bugs = file.categories[0];
    file.categories = [
      { ...bugs, name: bugs.name.toUpperCase(), rules: [...bugs.rules, { name: "No eval", description: "Never eval input.", severity: Severity.Major, enabled: true }] },
      { name: "Imported", color: CATEGORY_COLORS[1], description: "", globs: "*.ts", enabled: false, rules: [
        { name: "One", description: "First.", severity: Severity.Minor, enabled: true },
        { name: "one", description: "Duplicate.", severity: Severity.Minor, enabled: true },
      ] },
    ];

    expect(rules.importRules(JSON.stringify(file))).toEqual({ categories: 1, rules: 2, skipped: bugs.rules.length + 1 });
    const imported = rules.globalRules().find((c) => c.name === "Imported")!;
    expect(imported).toMatchObject({ enabled: false, globs: "*.ts" });
    expect(imported.rules.map((r) => r.name)).toEqual(["One"]);
    expect(rules.globalRules().find((c) => c.name === bugs.name)!.rules.at(-1)!.name).toBe("No eval");

    // Re-importing changes nothing.
    expect(rules.importRules(JSON.stringify(file)).rules).toBe(0);
  });

  it("rejects files that are not rules exports before writing", async () => {
    const rules = await import("./rules");
    const before = rules.globalRules().length;
    expect(() => rules.importRules("{")).toThrow("Not a JSON file");
    expect(() => rules.importRules(JSON.stringify({ version: 1, categories: [{ name: "X" }] }))).toThrow("Not a rules export file");
    expect(rules.globalRules()).toHaveLength(before);
  });
});
