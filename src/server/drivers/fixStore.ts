import { eq } from "drizzle-orm";
import { FindingStatus } from "@/lib/domain";
import { getDb } from "./db";
import { appliedFixes, findings } from "./schema";

type FixInput = typeof appliedFixes.$inferInsert & { findingId: number };
type FindingState = Pick<typeof findings.$inferSelect, "status" | "startLine" | "endLine">;
export type FixState = { id: number; before: FindingState; after: FindingState };

export function fixByFinding(findingId: number) {
  return getDb().select().from(appliedFixes).where(eq(appliedFixes.findingId, findingId)).get();
}

// Only return IDs to the UI; full file snapshots stay on the server.
export function undoableFixes(reviewId: number): number[] {
  return getDb().select({ id: appliedFixes.findingId }).from(appliedFixes)
    .innerJoin(findings, eq(findings.id, appliedFixes.findingId))
    .where(eq(findings.reviewId, reviewId)).all().map((f) => f.id);
}

// Record the inverse and finding changes together after the file write.
export function saveFix(input: FixInput, states: FixState[]): void {
  getDb().transaction((tx) => {
    tx.insert(appliedFixes).values(input).run();
    tx.update(findings).set({ status: FindingStatus.Fixed }).where(eq(findings.id, input.findingId)).run();
    for (const state of states) {
      tx.update(findings).set(state.after).where(eq(findings.id, state.id)).run();
    }
  });
}

// Restore only unchanged finding metadata, preserving later user decisions.
export function restoreFix(findingId: number, states: FixState[]): void {
  getDb().transaction((tx) => {
    tx.update(findings).set({ status: FindingStatus.Open }).where(eq(findings.id, findingId)).run();
    for (const state of states) {
      tx.update(findings).set(state.before).where(eq(findings.id, state.id)).run();
    }
    tx.delete(appliedFixes).where(eq(appliedFixes.findingId, findingId)).run();
  });
}
