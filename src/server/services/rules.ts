import picomatch from "picomatch";
import { z } from "zod";
import { CATEGORY_COLORS, CategoryKind, isBuiltIn, Scope, Severity } from "@/lib/domain";
import {
  categoriesFor,
  categoryById,
  categoryOverridesFor,
  deleteCategory,
  deleteCategoryOverride,
  deleteRule,
  deleteRuleOverride,
  insertCategory,
  insertRules,
  ruleById,
  ruleOverridesFor,
  rulesFor,
  setCategoryOverride,
  setRuleOverride,
  updateCategory,
  updateRule,
} from "@/server/drivers/ruleStore";
import type { Category, Rule } from "@/server/drivers/schema";
import { InputError } from "./errors";

// Rules model:
//
//   global category ──< global rule        (projectId null)
//         │       └───< project-only rule  (projectId set)
//         └── per project: category on/off, rule name/description/severity/on-off overrides
//   project category ──< project rules     (only in that project)
//
// effectiveRules(project) flattens this into the snapshot a review uses.

export type RuleView = {
  id: number;
  scope: Scope;
  name: string;
  description: string;
  severity: Severity;
  enabled: boolean;
  // Project view only: values come from a project override.
  overridden: boolean;
};

export type CategoryView = Omit<Category, "projectId"> & {
  scope: Scope;
  // Project view: global category switched on/off for this project.
  enabled: boolean;
  rules: RuleView[];
};

// Rules frozen into a review. Findings reference ids from here.
export type RulesSnapshot = {
  categories: {
    id: number;
    kind: CategoryKind;
    name: string;
    color: string;
    description: string;
    globs: string[];
    rules: { id: number; name: string; description: string; severity: Severity }[];
  }[];
};

const categorySchema = z.object({
  name: z.string().trim().min(1),
  color: z.enum(CATEGORY_COLORS),
  description: z.string().trim(),
  globs: z.string(),
});

const ruleSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  severity: z.enum(Severity),
  enabled: z.boolean(),
});

export type CategoryInput = z.input<typeof categorySchema>;
export type RuleInput = z.input<typeof ruleSchema>;

// Bullets and numbering people paste with rule lists.
// e.g. "- foo", "* foo", "1. foo", "2) foo", "[ ] foo" → "foo"
const LIST_MARKER = /^\s*(?:[-*•]|\d+[.)]|\[[ xX]?\])\s+/;

export function parseRuleList(pasted: string): string[] {
  return pasted
    .split(/\r?\n/)
    .map((line) => line.replace(LIST_MARKER, "").trim())
    .filter(Boolean);
}

export function splitGlobs(globs: string): string[] {
  return globs.split(/\r?\n/).map((g) => g.trim()).filter(Boolean);
}

// --- views -----------------------------------------------------------------

export function globalRules(): CategoryView[] {
  const rules = rulesFor(null);

  return categoriesFor(null).map((c) => ({
    ...c,
    scope: Scope.Global,
    enabled: c.enabled,
    rules: rules
      .filter((r) => r.categoryId === c.id)
      .map((r) => ({ ...pickRule(r), scope: Scope.Global, overridden: false })),
  }));
}

export function projectRules(projectId: number): CategoryView[] {
  const rules = rulesFor(projectId);
  const catOverrides = new Map(categoryOverridesFor(projectId).map((o) => [o.categoryId, o]));
  const ruleOverrides = new Map(ruleOverridesFor(projectId).map((o) => [o.ruleId, o]));

  return categoriesFor(projectId).map(({ projectId: owner, ...c }) => ({
    ...c,
    scope: owner === null ? Scope.Global : Scope.Project,
    enabled: catOverrides.get(c.id)?.enabled ?? c.enabled,
    rules: rules
      .filter((r) => r.categoryId === c.id)
      .map((r) => {
        const o = ruleOverrides.get(r.id);
        return {
          id: r.id,
          scope: r.projectId === null ? Scope.Global : Scope.Project,
          name: o?.name ?? r.name,
          description: o?.description ?? r.description,
          severity: o?.severity ?? r.severity,
          enabled: o?.enabled ?? r.enabled,
          overridden: Boolean(o),
        };
      }),
  }));
}

// Enabled categories and rules for a project, overrides applied.
// `only` = a rule set: exactly those rules, on/off switches ignored.
export function effectiveRules(projectId: number, only: ReadonlySet<number> | null = null): RulesSnapshot {
  const categories = projectRules(projectId)
    .filter((c) => only !== null || c.enabled)
    .map((c) => ({
      id: c.id,
      kind: c.kind,
      name: c.name,
      color: c.color,
      description: c.description,
      globs: splitGlobs(c.globs),
      rules: c.rules
        .filter((r) => (only === null ? r.enabled : only.has(r.id)))
        .map((r) => ({ id: r.id, name: r.name, description: r.description, severity: r.severity })),
    }))
    .filter((c) => c.rules.length > 0);

  return { categories };
}

function pickRule(r: Rule) {
  return { id: r.id, name: r.name, description: r.description, severity: r.severity, enabled: r.enabled };
}

// --- categories ------------------------------------------------------------

// projectId null = global category.
export function createCategory(projectId: number | null, input: CategoryInput): number {
  const c = categorySchema.parse(input);
  const position = categoriesFor(projectId).length;
  return insertCategory({ ...c, projectId, kind: CategoryKind.Custom, position }).id;
}

export function editCategory(id: number, input: CategoryInput): void {
  const c = categorySchema.parse(input);
  requireCategory(id);
  updateCategory(id, c);
}

export function removeCategory(id: number): void {
  const c = requireCategory(id);
  if (isBuiltIn(c.kind)) {
    throw new InputError("Built-in categories can't be deleted. Disable them instead.");
  }

  deleteCategory(id);
}

// Global default on/off. Projects without an override follow it.
export function setCategoryDefault(categoryId: number, enabled: boolean): void {
  requireCategory(categoryId);
  updateCategory(categoryId, { enabled });
}

// Switches a category on/off for one project only.
export function toggleCategory(projectId: number, categoryId: number, enabled: boolean): void {
  requireCategory(categoryId);
  setCategoryOverride(projectId, categoryId, enabled);
}

// Drops the project's on/off choice so the category follows the global default.
export function resetCategory(projectId: number, categoryId: number): void {
  deleteCategoryOverride(projectId, categoryId);
}

export type LanguageUsage = { categoryId: number; name: string; color: string; files: number; enabled: boolean };

// Language packs with how many of the project's files each one covers.
// e.g. a Django + React repo → Python 120, JavaScript 80, TypeScript 0
export function languageUsage(projectId: number, files: string[]): LanguageUsage[] {
  return projectRules(projectId)
    .filter((c) => c.kind === CategoryKind.Language)
    .map((c) => {
      const globs = splitGlobs(c.globs);
      const matches = globs.length ? picomatch(globs, { dot: true }) : () => true;
      return {
        categoryId: c.id,
        name: c.name,
        color: c.color,
        files: files.filter((f) => matches(f)).length,
        enabled: c.enabled,
      };
    });
}

function requireCategory(id: number): Category {
  const c = categoryById(id);
  if (!c) {
    throw new InputError("Unknown category");
  }

  return c;
}

// --- rules -----------------------------------------------------------------

// Adds named rules together; projectId limits them to that project.
export function addRules(
  categoryId: number,
  projectId: number | null,
  input: RuleInput | RuleInput[],
): number {
  const category = requireCategory(categoryId);
  if (category.projectId !== null && category.projectId !== projectId) {
    throw new InputError("Category belongs to another project");
  }

  // Validate the entire batch before the single insert.
  const batch = z.array(ruleSchema).min(1).parse(Array.isArray(input) ? input : [input]);
  const position = rulesFor(projectId).filter((r) => r.categoryId === categoryId).length;
  insertRules(batch.map((rule, index) => ({ ...rule, categoryId, projectId, position: position + index })));
  return batch.length;
}

// Edits a rule in place: global rules from the global page, project-only
// rules from the project page.
export function editRule(id: number, input: RuleInput): void {
  const r = ruleSchema.parse(input);
  requireRule(id);
  updateRule(id, r);
}

export function removeRule(id: number): void {
  requireRule(id);
  deleteRule(id);
}

// Project-level change to a global rule. Null fields inherit.
export function overrideRule(
  projectId: number,
  ruleId: number,
  patch: { name?: string | null; description?: string | null; severity?: Severity | null; enabled?: boolean | null },
): void {
  const rule = requireRule(ruleId);
  if (rule.projectId !== null) {
    throw new InputError("Project rules are edited directly, not overridden");
  }

  const p = z
    .object({
      name: z.string().trim().min(1).nullable().optional(),
      description: z.string().trim().min(1).nullable().optional(),
      severity: z.enum(Severity).nullable().optional(),
      enabled: z.boolean().nullable().optional(),
    })
    .parse(patch);
  setRuleOverride(projectId, ruleId, p);
}

export function resetRule(projectId: number, ruleId: number): void {
  deleteRuleOverride(projectId, ruleId);
}

// --- export / import -------------------------------------------------------

// Portable global rules. No ids: import matches categories and rules by name.
//   { "version": 1, "categories": [{ "name": "Security", "color": "red", …,
//     "rules": [{ "name": "No eval", "description": "…", … }] }] }
const RULES_FILE_VERSION = 1;

const rulesFileSchema = z.object({
  version: z.literal(RULES_FILE_VERSION),
  categories: z.array(categorySchema.extend({ enabled: z.boolean(), rules: z.array(ruleSchema) })),
});

export type ImportSummary = { categories: number; rules: number; skipped: number };

export function exportRules() {
  return {
    version: RULES_FILE_VERSION,
    categories: globalRules().map((c) => ({
      name: c.name,
      color: c.color,
      description: c.description,
      globs: c.globs,
      enabled: c.enabled,
      rules: c.rules.map(({ name, description, severity, enabled }) => ({ name, description, severity, enabled })),
    })),
  };
}

// Merges a rules file into the global rules. Names match case-insensitively:
// unknown categories and rules are added, known ones stay untouched.
// e.g. file "bugs" + rule "No eval" → added to the existing Bugs category
export function importRules(text: string): ImportSummary {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new InputError("Not a JSON file");
  }

  // Validate the whole file before writing anything.
  const parsed = rulesFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new InputError("Not a rules export file");
  }

  const summary: ImportSummary = { categories: 0, rules: 0, skipped: 0 };
  for (const c of parsed.data.categories) {
    // Re-read each time: the file may repeat a category.
    const match = globalRules().find((e) => sameName(e.name, c.name));
    const categoryId = match?.id ?? createCategory(null, c);
    if (!match) {
      updateCategory(categoryId, { enabled: c.enabled });
      summary.categories++;
    }

    const known = new Set((match?.rules ?? []).map((r) => r.name.toLowerCase()));
    const fresh = c.rules.filter((r) => {
      const key = r.name.toLowerCase();
      const isNew = !known.has(key);
      known.add(key);
      return isNew;
    });

    summary.skipped += c.rules.length - fresh.length;
    if (fresh.length > 0) {
      summary.rules += addRules(categoryId, null, fresh);
    }
  }

  return summary;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function requireRule(id: number): Rule {
  const r = ruleById(id);
  if (!r) {
    throw new InputError("Unknown rule");
  }

  return r;
}
