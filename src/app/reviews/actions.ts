"use server";

import { connection } from "next/server";
import { refresh } from "next/cache";
import { loadChat as chatOf } from "@/server/services/chat";
import * as engine from "@/server/services/review/engine";
import * as reviews from "@/server/services/reviews";
import { attempt } from "../result";

// Review report API: report data, review control and finding actions.
// Chat streaming and Markdown export are route handlers under /api/reviews.

export type { Finding, Report, ReviewFile, RulesSnapshot, UnitView } from "@/server/services/reviews";

export async function getReport(id: number) {
  await connection();
  return reviews.getReport(id);
}

// Exact prompt a unit sent to the model.
export async function unitPrompt(unitId: number) {
  return attempt(() => reviews.unitPrompt(unitId));
}

export async function loadChat(reviewId: number) {
  await connection();
  return chatOf(reviewId);
}

export async function cancelReview(id: number) {
  engine.cancelReview(id);
  refresh();
}

// Re-runs failed or interrupted units only.
export async function retryReview(id: number) {
  const result = await attempt(() => engine.retryReview(id));
  refresh();
  return result;
}

// Re-reads the diff from disk (e.g. after local edits).
export async function refreshReview(id: number) {
  const result = await attempt(() => engine.refreshReview(id));
  refresh();
  return result;
}

// Reviews files whose diff changed since the last run.
export async function rereviewChanged(id: number) {
  const result = await attempt(() => engine.rereviewChanged(id));
  refresh();
  return result;
}

export async function removeReview(id: number) {
  const result = await attempt(() => reviews.removeReview(id));
  refresh();
  return result;
}

export async function dismissFinding(id: number, reason: string) {
  const result = await attempt(() => reviews.dismissFinding(id, reason));
  refresh();
  return result;
}

export async function markFixed(id: number) {
  const result = await attempt(() => reviews.markFixed(id));
  refresh();
  return result;
}

export async function reopenFinding(id: number) {
  const result = await attempt(() => reviews.reopenFinding(id));
  refresh();
  return result;
}

// Writes the suggested fix into the working tree.
export async function applyFix(id: number) {
  const result = await attempt(() => reviews.applyFix(id));
  refresh();
  return result;
}

// Restore the saved file version and reopen the finding.
export async function undoFix(id: number) {
  const result = await attempt(() => reviews.undoFix(id));
  refresh();
  return result;
}
