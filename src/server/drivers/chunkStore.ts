import { and, count, countDistinct, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { codeChunks } from "./schema";

// Semantic search chunks of a project, per embedding model. Vectors are
// stored as Float32 bytes.

export type ChunkRow = { path: string; version: string; startLine: number; endLine: number; vector: Float32Array };

// SQLite caps bound parameters per statement; inserts go in batches.
const INSERT_BATCH = 100;

function scope(projectId: number, model: string) {
  return and(eq(codeChunks.projectId, projectId), eq(codeChunks.model, model));
}

// File → version and number of its stored chunks.
export function chunkVersions(projectId: number, model: string): Map<string, { version: string; chunks: number }> {
  const rows = getDb()
    .select({ path: codeChunks.path, version: codeChunks.version, chunks: count() })
    .from(codeChunks)
    .where(scope(projectId, model))
    .groupBy(codeChunks.path, codeChunks.version)
    .all();
  return new Map(rows.map((r) => [r.path, { version: r.version, chunks: r.chunks }]));
}

// Replaces the chunks of the given files with `rows`.
export function replaceChunks(projectId: number, model: string, files: string[], rows: ChunkRow[]): void {
  getDb().transaction((tx) => {
    for (let i = 0; i < files.length; i += INSERT_BATCH) {
      tx.delete(codeChunks).where(and(scope(projectId, model), inArray(codeChunks.path, files.slice(i, i + INSERT_BATCH)))).run();
    }

    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const batch = rows.slice(i, i + INSERT_BATCH).map((r) => ({
        projectId,
        model,
        path: r.path,
        version: r.version,
        startLine: r.startLine,
        endLine: r.endLine,
        vector: Buffer.from(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength),
      }));
      tx.insert(codeChunks).values(batch).run();
    }
  });
}

export function loadChunks(projectId: number, model: string): ChunkRow[] {
  return getDb()
    .select()
    .from(codeChunks)
    .where(scope(projectId, model))
    .all()
    .map((r) => ({
      path: r.path,
      version: r.version,
      startLine: r.startLine,
      endLine: r.endLine,
      // Copy: the row's buffer may share a pool and be misaligned for Float32.
      vector: new Float32Array(new Uint8Array(r.vector).buffer),
    }));
}

// Chunks and files stored, per model, e.g. to tell an index built with
// another model.
export function chunkCounts(projectId: number): { model: string; chunks: number; files: number }[] {
  return getDb()
    .select({ model: codeChunks.model, chunks: count(), files: countDistinct(codeChunks.path) })
    .from(codeChunks)
    .where(eq(codeChunks.projectId, projectId))
    .groupBy(codeChunks.model)
    .all();
}

export function deleteChunks(projectId: number): void {
  getDb().delete(codeChunks).where(eq(codeChunks.projectId, projectId)).run();
}
