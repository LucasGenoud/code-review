// Semantic search index state, shared by server and UI. Client-safe.

export enum IndexPhase {
  None = "none",
  Building = "building",
  Ready = "ready",
  Failed = "failed",
}

export type SemanticStatus = {
  // False when no embedding model is set (Settings → Semantic search).
  configured: boolean;
  phase: IndexPhase;
  // Chunks embedded so far, of those to embed in this run.
  done: number;
  total: number;
  tokens: number;
  error: string | null;
  // Stored for the current model.
  chunks: number;
  files: number;
  // Chunks of another model: the index must be rebuilt.
  stale: boolean;
  capped: boolean;
};
