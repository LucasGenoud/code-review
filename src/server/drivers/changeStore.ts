import { and, desc, eq } from "drizzle-orm";
import { ChangeStatus } from "@/lib/domain";
import { getDb } from "./db";
import { ruleChanges, type RuleChange } from "./schema";

export type ChangeInput = Omit<typeof ruleChanges.$inferInsert, "id" | "createdAt">;

export function insertChanges(input: ChangeInput[]): void {
  if (input.length === 0) {
    return;
  }

  getDb().insert(ruleChanges).values(input).run();
}

export function pendingChanges(projectId: number): RuleChange[] {
  return getDb()
    .select()
    .from(ruleChanges)
    .where(and(eq(ruleChanges.projectId, projectId), eq(ruleChanges.status, ChangeStatus.Pending)))
    .orderBy(desc(ruleChanges.id))
    .all();
}

export function changeById(id: number): RuleChange | undefined {
  return getDb().select().from(ruleChanges).where(eq(ruleChanges.id, id)).get();
}

export function setChangeStatus(id: number, status: ChangeStatus): void {
  getDb().update(ruleChanges).set({ status }).where(eq(ruleChanges.id, id)).run();
}
