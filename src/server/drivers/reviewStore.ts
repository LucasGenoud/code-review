import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { FindingStatus, ReviewStatus, UnitStatus } from "@/lib/domain";
import { getDb } from "./db";
import {
  findings,
  reviewFiles,
  reviews,
  reviewUnits,
  type Finding,
  type Review,
  type ReviewFile,
  type ReviewUnit,
} from "./schema";

export type ReviewInput = Omit<typeof reviews.$inferInsert, "id" | "createdAt">;
export type FileInput = Omit<typeof reviewFiles.$inferInsert, "id">;
export type UnitInput = Omit<typeof reviewUnits.$inferInsert, "id">;
export type FindingInput = Omit<typeof findings.$inferInsert, "id" | "createdAt">;

// --- reviews ---------------------------------------------------------------

export function insertReview(input: ReviewInput): Review {
  return getDb().insert(reviews).values(input).returning().get();
}

export function reviewById(id: number): Review | undefined {
  return getDb().select().from(reviews).where(eq(reviews.id, id)).get();
}

export function reviewsForProject(projectId: number): Review[] {
  return getDb()
    .select()
    .from(reviews)
    .where(eq(reviews.projectId, projectId))
    .orderBy(desc(reviews.id))
    .all();
}

export function reviewsWithStatus(status: ReviewStatus): Review[] {
  return getDb().select().from(reviews).where(eq(reviews.status, status)).all();
}

export function updateReview(id: number, patch: Partial<ReviewInput>): void {
  getDb().update(reviews).set(patch).where(eq(reviews.id, id)).run();
}

export function addReviewTokens(id: number, input: number, output: number): void {
  getDb()
    .update(reviews)
    .set({
      inputTokens: sql`${reviews.inputTokens} + ${input}`,
      outputTokens: sql`${reviews.outputTokens} + ${output}`,
    })
    .where(eq(reviews.id, id))
    .run();
}

export function deleteReview(id: number): void {
  getDb().delete(reviews).where(eq(reviews.id, id)).run();
}

// --- files -----------------------------------------------------------------

export function insertFiles(input: FileInput[]): ReviewFile[] {
  if (input.length === 0) {
    return [];
  }

  return getDb().insert(reviewFiles).values(input).returning().all();
}

export function filesForReview(reviewId: number): ReviewFile[] {
  return getDb()
    .select()
    .from(reviewFiles)
    .where(eq(reviewFiles.reviewId, reviewId))
    .orderBy(asc(reviewFiles.path))
    .all();
}

export function fileById(id: number): ReviewFile | undefined {
  return getDb().select().from(reviewFiles).where(eq(reviewFiles.id, id)).get();
}

export function updateFile(id: number, patch: Partial<FileInput>): void {
  getDb().update(reviewFiles).set(patch).where(eq(reviewFiles.id, id)).run();
}

export function deleteFile(id: number): void {
  getDb().delete(reviewFiles).where(eq(reviewFiles.id, id)).run();
}

// --- units -----------------------------------------------------------------

export function insertUnits(input: UnitInput[]): ReviewUnit[] {
  if (input.length === 0) {
    return [];
  }

  return getDb().insert(reviewUnits).values(input).returning().all();
}

export function unitsForReview(reviewId: number): ReviewUnit[] {
  return getDb()
    .select()
    .from(reviewUnits)
    .where(eq(reviewUnits.reviewId, reviewId))
    .orderBy(asc(reviewUnits.id))
    .all();
}

export function unitById(id: number): ReviewUnit | undefined {
  return getDb().select().from(reviewUnits).where(eq(reviewUnits.id, id)).get();
}

export function updateUnit(id: number, patch: Partial<UnitInput>): void {
  getDb().update(reviewUnits).set(patch).where(eq(reviewUnits.id, id)).run();
}

export function deleteUnitsForFile(fileId: number): void {
  getDb().delete(reviewUnits).where(eq(reviewUnits.fileId, fileId)).run();
}

// Units left `running` by a crash or cancel go back to the queue.
export function requeueRunningUnits(reviewId: number): void {
  getDb()
    .update(reviewUnits)
    .set({ status: UnitStatus.Pending })
    .where(and(eq(reviewUnits.reviewId, reviewId), eq(reviewUnits.status, UnitStatus.Running)))
    .run();
}

export function resetFailedUnits(reviewId: number): void {
  getDb()
    .update(reviewUnits)
    .set({ status: UnitStatus.Pending, error: null })
    .where(and(eq(reviewUnits.reviewId, reviewId), eq(reviewUnits.status, UnitStatus.Failed)))
    .run();
}

// --- findings --------------------------------------------------------------

export function insertFindings(input: FindingInput[]): void {
  if (input.length === 0) {
    return;
  }

  getDb().insert(findings).values(input).run();
}

export function findingsForReview(reviewId: number): Finding[] {
  return getDb()
    .select()
    .from(findings)
    .where(eq(findings.reviewId, reviewId))
    .orderBy(asc(findings.path), asc(findings.startLine))
    .all();
}

export function findingsForFile(fileId: number): Finding[] {
  return getDb().select().from(findings).where(eq(findings.fileId, fileId)).all();
}

export function findingById(id: number): Finding | undefined {
  return getDb().select().from(findings).where(eq(findings.id, id)).get();
}

export function updateFinding(id: number, patch: Partial<FindingInput>): void {
  getDb().update(findings).set(patch).where(eq(findings.id, id)).run();
}

export function deleteFindings(ids: number[]): void {
  if (ids.length === 0) {
    return;
  }

  getDb().delete(findings).where(inArray(findings.id, ids)).run();
}

// Drops findings the user hasn't acted on, before a file is re-reviewed.
export function deleteOpenFindings(fileId: number): void {
  getDb()
    .delete(findings)
    .where(
      and(
        eq(findings.fileId, fileId),
        inArray(findings.status, [FindingStatus.Open, FindingStatus.Outdated]),
      ),
    )
    .run();
}

// Dismissed findings of a project not yet used to propose rule changes.
export function unusedDismissals(projectId: number): Finding[] {
  return getDb()
    .select({ finding: findings })
    .from(findings)
    .innerJoin(reviews, eq(findings.reviewId, reviews.id))
    .where(
      and(
        eq(reviews.projectId, projectId),
        eq(findings.status, FindingStatus.Dismissed),
        eq(findings.feedbackUsed, false),
      ),
    )
    .all()
    .map((r) => r.finding);
}

export function markFeedbackUsed(ids: number[]): void {
  if (ids.length === 0) {
    return;
  }

  getDb().update(findings).set({ feedbackUsed: true }).where(inArray(findings.id, ids)).run();
}
