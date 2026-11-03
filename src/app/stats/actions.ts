"use server";

import { connection } from "next/server";
import * as stats from "@/server/services/stats";

// Statistics API: read-only aggregates over every review.

export type { DayStats, ModelStats, ProjectStats, RuleStats, Spend, Stats } from "@/server/services/stats";

export async function globalStats() {
  await connection();
  return stats.globalStats();
}
