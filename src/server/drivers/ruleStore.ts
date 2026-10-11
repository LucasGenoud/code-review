import { and, asc, eq, isNull, or } from "drizzle-orm";
import { getDb } from "./db";
import {
  categories,
  categoryOverrides,
  ruleOverrides,
  rules,
  type Category,
  type CategoryOverride,
  type Rule,
  type RuleOverride,
} from "./schema";

export type CategoryInput = Omit<typeof categories.$inferInsert, "id">;
export type RuleInput = Omit<typeof rules.$inferInsert, "id">;
export type RuleOverridePatch = Partial<Pick<RuleOverride, "enabled" | "name" | "description" | "severity">>;

// Global categories plus the project's own (projectId null = global only).
export function categoriesFor(projectId: number | null): Category[] {
  const scope = projectId === null
    ? isNull(categories.projectId)
    : or(isNull(categories.projectId), eq(categories.projectId, projectId));

  return getDb()
    .select()
    .from(categories)
    .where(scope)
    .orderBy(asc(categories.position), asc(categories.id))
    .all();
}

export function categoryById(id: number): Category | undefined {
  return getDb().select().from(categories).where(eq(categories.id, id)).get();
}

export function insertCategory(input: CategoryInput): Category {
  return getDb().insert(categories).values(input).returning().get();
}

export function updateCategory(id: number, input: Partial<CategoryInput>): void {
  getDb().update(categories).set(input).where(eq(categories.id, id)).run();
}

export function deleteCategory(id: number): void {
  getDb().delete(categories).where(eq(categories.id, id)).run();
}

// Global rules plus the project's own (projectId null = global only).
export function rulesFor(projectId: number | null): Rule[] {
  const scope = projectId === null
    ? isNull(rules.projectId)
    : or(isNull(rules.projectId), eq(rules.projectId, projectId));

  return getDb()
    .select()
    .from(rules)
    .where(scope)
    .orderBy(asc(rules.position), asc(rules.id))
    .all();
}

export function ruleById(id: number): Rule | undefined {
  return getDb().select().from(rules).where(eq(rules.id, id)).get();
}

export function insertRules(input: RuleInput[]): void {
  if (input.length === 0) {
    return;
  }

  getDb().insert(rules).values(input).run();
}

export function updateRule(id: number, input: Partial<RuleInput>): void {
  getDb().update(rules).set(input).where(eq(rules.id, id)).run();
}

export function deleteRule(id: number): void {
  getDb().delete(rules).where(eq(rules.id, id)).run();
}

export function categoryOverridesFor(projectId: number): CategoryOverride[] {
  return getDb()
    .select()
    .from(categoryOverrides)
    .where(eq(categoryOverrides.projectId, projectId))
    .all();
}

export function setCategoryOverride(projectId: number, categoryId: number, enabled: boolean): void {
  getDb()
    .insert(categoryOverrides)
    .values({ projectId, categoryId, enabled })
    .onConflictDoUpdate({
      target: [categoryOverrides.projectId, categoryOverrides.categoryId],
      set: { enabled },
    })
    .run();
}

export function deleteCategoryOverride(projectId: number, categoryId: number): void {
  getDb()
    .delete(categoryOverrides)
    .where(
      and(eq(categoryOverrides.projectId, projectId), eq(categoryOverrides.categoryId, categoryId)),
    )
    .run();
}

export function ruleOverridesFor(projectId: number): RuleOverride[] {
  return getDb().select().from(ruleOverrides).where(eq(ruleOverrides.projectId, projectId)).all();
}

export function setRuleOverride(projectId: number, ruleId: number, patch: RuleOverridePatch): void {
  getDb()
    .insert(ruleOverrides)
    .values({ projectId, ruleId, ...patch })
    .onConflictDoUpdate({ target: [ruleOverrides.projectId, ruleOverrides.ruleId], set: patch })
    .run();
}

export function deleteRuleOverride(projectId: number, ruleId: number): void {
  getDb()
    .delete(ruleOverrides)
    .where(and(eq(ruleOverrides.projectId, projectId), eq(ruleOverrides.ruleId, ruleId)))
    .run();
}
