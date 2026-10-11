// Runs once when the server starts.
export async function register() {
  // Node only, and never during `next build` (no DB there).
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  // Reviews marked running were cut off by the restart.
  const { recoverInterrupted } = await import("@/server/services/review/engine");
  recoverInterrupted();
}
