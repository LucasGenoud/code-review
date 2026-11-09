import path from "node:path";
import picomatch from "picomatch";
import { chunkCounts, chunkVersions, deleteChunks, loadChunks, replaceChunks, type ChunkRow } from "@/server/drivers/chunkStore";
import { IndexPhase, type SemanticStatus } from "@/lib/semantic";
import { contentHash } from "@/server/drivers/crypto";
import { readBytes } from "@/server/drivers/fs";
import { changedFiles, fileBlobs } from "@/server/drivers/git";
import { embedTexts, type EmbeddingConfig } from "@/server/drivers/llm";
import { projectById } from "@/server/drivers/projectStore";
import { InputError } from "./errors";
import { isTestPath } from "./paths";
import { resolveEmbedding } from "./providers";
import { splitGlobs } from "./rules";
import { getEmbeddingSettings, getSettings } from "./settings";
import { declarations } from "./symbols";

// Semantic search: finds code by meaning when its words differ from the
// question's ("command palette" → commandsQuickAccess.ts). The code is
// split into chunks at declarations, each embedded once with the
// configured embedding model; a query is embedded and compared to every
// chunk by cosine similarity.
//
//   Build (project page) ─► chunks ─► /embeddings in batches ─► code_chunks
//   each chat turn ─► search ─► background refresh of changed files
//
// Opt-in per project: embedding a large repository costs tokens. Files
// keep their vectors while their blob id (or, when changed in the working
// tree, content hash) is unchanged.

// Chunks: cut at declarations, at least MIN_LINES, at most MAX_LINES;
// files without declarations (markup) in windows of MAX_LINES.
const MIN_LINES = 12;
const MAX_LINES = 80;
const MAX_CHUNK_CHARS = 2_000;
const MAX_FILE_BYTES = 512 * 1024;
// Index size cap: beyond it, tests are left out first, then remaining files.
const MAX_CHUNKS = 40_000;
const EMBED_BATCH = 64;
// A chat turn refreshes an index older than this, in the background.
const REFRESH_MS = 60_000;
const HITS_PER_FILE = 2;
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|java|kt|kts|scala|groovy|cs|go|rs|rb|php|swift|c|h|cc|cpp|hpp|m|mm|dart|lua|ex|exs|vue|svelte|sql|xhtml|jsp|jspx|html|xml|yml|yaml|properties|md)$/i;
const SKIP = /(^|\/)(generated|vendor|third_party|dist|node_modules)\/|\.min\.|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;

export type SemanticHit = { path: string; startLine: number; endLine: number; score: number };

type Job = { phase: IndexPhase; done: number; total: number; tokens: number; error: string | null; capped: boolean; abort: AbortController; refreshedAt: number };

// Survive dev hot reloads.
const cache = globalThis as unknown as { semanticJobs?: Map<number, Job>; semanticVectors?: Map<number, { model: string; rows: ChunkRow[] }> };
const jobs = (cache.semanticJobs ??= new Map());
const vectors = (cache.semanticVectors ??= new Map());

export function semanticStatus(projectId: number): SemanticStatus {
  const cfg = resolveEmbedding();
  const counts = chunkCounts(projectId);
  const current = counts.find((c) => c.model === cfg?.name);
  const job = jobs.get(projectId);

  return {
    configured: cfg !== null,
    phase: job?.phase ?? (current ? IndexPhase.Ready : IndexPhase.None),
    done: job?.done ?? 0,
    total: job?.total ?? 0,
    tokens: job?.tokens ?? 0,
    error: job?.error ?? null,
    chunks: current?.chunks ?? 0,
    files: current?.files ?? 0,
    stale: counts.some((c) => c.model !== cfg?.name),
    capped: job?.capped ?? false,
  };
}

// Starts building or updating the index; progress via semanticStatus.
export function buildSemanticIndex(projectId: number): void {
  const cfg = resolveEmbedding();
  if (!cfg) {
    throw new InputError("Set an embedding model in Settings → Semantic search first.");
  }

  if (jobs.get(projectId)?.phase === IndexPhase.Building) {
    return;
  }

  start(projectId, cfg);
}

export function stopSemanticIndex(projectId: number): void {
  jobs.get(projectId)?.abort.abort();
}

export function removeSemanticIndex(projectId: number): void {
  stopSemanticIndex(projectId);
  jobs.delete(projectId);
  vectors.delete(projectId);
  deleteChunks(projectId);
}

// True when the project has an index for the current model.
export function hasSemanticIndex(projectId: number): boolean {
  const cfg = resolveEmbedding();
  return cfg !== null && chunkCounts(projectId).some((c) => c.model === cfg.name && c.chunks > 0);
}

// The chunks closest in meaning to `query`, at most HITS_PER_FILE per
// file; null without an index. Refreshes a stale index in the background.
export async function semanticSearch(projectId: number, query: string, limit: number, glob: string | null = null): Promise<SemanticHit[] | null> {
  const cfg = resolveEmbedding();
  if (!cfg || !hasSemanticIndex(projectId)) {
    return null;
  }

  const job = jobs.get(projectId);
  if (job?.phase !== IndexPhase.Building && Date.now() - (job?.refreshedAt ?? 0) > REFRESH_MS) {
    start(projectId, cfg);
  }

  const rows = rowsFor(projectId, cfg.name);
  // Instruction-aware models embed queries with their task prefix, code without.
  const [q] = (await embedTexts(cfg, [getEmbeddingSettings().queryPrefix + query])).vectors;
  normalize(q);

  const isMatch = glob ? picomatch(glob, { dot: true }) : () => true;
  const scored = rows.filter((r) => isMatch(r.path)).map((r) => ({ r, score: dot(q, r.vector) }));
  scored.sort((a, b) => b.score - a.score);

  const perFile = new Map<string, number>();
  const hits: SemanticHit[] = [];
  for (const { r, score } of scored) {
    const n = perFile.get(r.path) ?? 0;
    if (n >= HITS_PER_FILE) {
      continue;
    }

    perFile.set(r.path, n + 1);
    hits.push({ path: r.path, startLine: r.startLine, endLine: r.endLine, score });
    if (hits.length >= limit) {
      break;
    }
  }

  return hits;
}

// Vectors of the project, normalized, cached until the next index write.
function rowsFor(projectId: number, model: string): ChunkRow[] {
  const cached = vectors.get(projectId);
  if (cached?.model === model) {
    return cached.rows;
  }

  const rows = loadChunks(projectId, model);
  rows.forEach((r) => normalize(r.vector));
  vectors.set(projectId, { model, rows });
  return rows;
}

function start(projectId: number, cfg: EmbeddingConfig): void {
  const job: Job = { phase: IndexPhase.Building, done: 0, total: 0, tokens: 0, error: null, capped: false, abort: new AbortController(), refreshedAt: Date.now() };
  jobs.set(projectId, job);

  void run(projectId, cfg, job).then(
    () => {
      job.phase = IndexPhase.Ready;
    },
    (e: unknown) => {
      job.phase = job.abort.signal.aborted ? IndexPhase.Ready : IndexPhase.Failed;
      job.error = job.abort.signal.aborted ? null : e instanceof Error ? e.message : String(e);
    },
  );
}

type FileChunks = { path: string; version: string; chunks: { startLine: number; endLine: number; text: string }[] };

// Embeds new and changed files, drops deleted ones. Writes file by file,
// so a stopped or failed run keeps what it embedded.
async function run(projectId: number, cfg: EmbeddingConfig, job: Job): Promise<void> {
  const project = projectById(projectId);
  if (!project) {
    throw new InputError("Unknown project");
  }

  const ignored = picomatch([...splitGlobs(getSettings().ignoreGlobs), ...splitGlobs(project.ignoreGlobs)], { dot: true });
  const [blobs, changed] = await Promise.all([fileBlobs(project.path), changedFiles(project.path).catch(() => [])]);
  const dirty = new Set(changed.map((c) => c.path));
  const files = [...blobs.keys()].filter((f) => CODE.test(f) && !SKIP.test(f) && !ignored(f));
  const stored = chunkVersions(projectId, cfg.name);

  const wanted = new Set(files);
  replaceChunks(projectId, cfg.name, [...stored.keys()].filter((f) => !wanted.has(f)), []);

  // Tests last: they go first when the cap is reached.
  const ordered = [...files].sort((a, b) => Number(isTestPath(a)) - Number(isTestPath(b)));
  let room = MAX_CHUNKS - [...stored].filter(([f]) => wanted.has(f)).reduce((n, [, s]) => n + s.chunks, 0);
  const todo: FileChunks[] = [];

  for (const file of ordered) {
    // Clean files are known unchanged by blob id, without reading them.
    const blob = blobs.get(file) ?? null;
    const before = stored.get(file);
    if (!dirty.has(file) && before?.version === blob) {
      continue;
    }

    const text = await readText(project.path, file);
    const version = text !== null && dirty.has(file) ? `h:${contentHash(text)}` : blob;
    if (text === null || version === null || before?.version === version) {
      continue;
    }

    // A re-embedded file frees its old chunks.
    const chunks = chunkFile(file, text);
    if (chunks.length > room + (before?.chunks ?? 0)) {
      job.capped = true;
      continue;
    }

    room -= chunks.length - (before?.chunks ?? 0);
    todo.push({ path: file, version, chunks });
  }

  job.total = todo.reduce((n, f) => n + f.chunks.length, 0);
  let batch: FileChunks[] = [];
  let size = 0;

  for (const file of todo) {
    batch.push(file);
    size += file.chunks.length;
    if (size >= EMBED_BATCH) {
      await embedBatch(projectId, cfg, job, batch);
      batch = [];
      size = 0;
    }
  }

  if (batch.length > 0) {
    await embedBatch(projectId, cfg, job, batch);
  }

  vectors.delete(projectId);
  job.refreshedAt = Date.now();
}

async function embedBatch(projectId: number, cfg: EmbeddingConfig, job: Job, files: FileChunks[]): Promise<void> {
  const values = files.flatMap((f) => f.chunks.map((c) => c.text));
  const { vectors: embedded, tokens } = await embedTexts(cfg, values, job.abort.signal);

  let i = 0;
  const rows: ChunkRow[] = files.flatMap((f) => f.chunks.map((c) => ({ path: f.path, version: f.version, startLine: c.startLine, endLine: c.endLine, vector: embedded[i++] })));
  replaceChunks(projectId, cfg.name, files.map((f) => f.path), rows);
  job.done += values.length;
  job.tokens += tokens;
}

async function readText(dir: string, file: string): Promise<string | null> {
  const bytes = await readBytes(path.join(dir, file));
  if (!bytes || bytes.length > MAX_FILE_BYTES || bytes.includes(0)) {
    return null;
  }

  return bytes.toString("utf8");
}

// Chunks of a file, each prefixed with its location so the vector knows
// where it lives: "src/pay.ts:40-90\n<code>".
function chunkFile(file: string, text: string): { startLine: number; endLine: number; text: string }[] {
  const lines = text.split(/\r?\n/);
  const starts = [...new Set(declarations(text).map((d) => d.line))].sort((a, b) => a - b);
  const spans: [number, number][] = [];

  let from = 1;
  for (const line of starts) {
    if (line - from >= MIN_LINES) {
      spans.push([from, line - 1]);
      from = line;
    }
  }
  spans.push([from, lines.length]);

  return spans
    .flatMap(([a, b]) => windows(a, b))
    .map(([a, b]) => ({ startLine: a, endLine: b, body: lines.slice(a - 1, b).join("\n") }))
    .filter((c) => c.body.trim().length > 0)
    .map((c) => ({ startLine: c.startLine, endLine: c.endLine, text: `${file}:${c.startLine}-${c.endLine}\n${c.body}`.slice(0, MAX_CHUNK_CHARS) }));
}

// [1, 200] → [1, 80], [81, 160], [161, 200].
function windows(from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (let a = from; a <= to; a += MAX_LINES) {
    out.push([a, Math.min(to, a + MAX_LINES - 1)]);
  }

  return out;
}

function normalize(v: Float32Array): void {
  const norm = Math.sqrt(dot(v, v)) || 1;
  for (let i = 0; i < v.length; i++) {
    v[i] /= norm;
  }
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    sum += a[i] * b[i];
  }

  return sum;
}
