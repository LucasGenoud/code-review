import crypto from "node:crypto";
import picomatch from "picomatch";
import { z } from "zod";
import {
  CategoryKind,
  FileChange,
  FileState,
  FindingStatus,
  ReviewStatus,
  SEVERITY_RANK,
  UnitStatus,
} from "@/lib/domain";
import { wordUsages } from "@/server/drivers/git";
import { generateObject, generatePlain, type Usage } from "@/server/drivers/llm";
import { undoableFixes } from "@/server/drivers/fixStore";
import { projectById } from "@/server/drivers/projectStore";
import {
  addReviewTokens,
  deleteFindings,
  deleteOpenFindings,
  deleteUnitsForFile,
  fileById,
  filesForReview,
  findingsForFile,
  insertFiles,
  insertFindings,
  insertReview,
  insertUnits,
  requeueRunningUnits,
  resetFailedUnits,
  reviewById,
  reviewsWithStatus,
  unitsForReview,
  updateFile,
  updateFinding,
  updateReview,
  updateUnit,
  type FindingInput,
} from "@/server/drivers/reviewStore";
import type { Finding, Project, Review, ReviewFile, ReviewUnit } from "@/server/drivers/schema";
import { headContent, loadDiff, resolveSource, type DiffSource, type Resolved } from "../diff";
import { parseDiff, type Hunk, type ParsedFile } from "../diffParse";
import { InputError } from "../errors";
import { resolveModel, type ResolvedModel } from "../providers";
import { effectiveRules, splitGlobs, type RulesSnapshot } from "../rules";
import { getSettings } from "../settings";
import { locate } from "./locate";
import { modelLimiter } from "./limiter";
import {
  findingsSchema,
  hunkTokens,
  lookupPrompt,
  lookupSchema,
  MAX_LOOKUPS,
  overviewPrompt,
  PassKind,
  unitOverhead,
  unitPrompt,
  type FindingDraft,
} from "./prompts";

// Review pipeline:
//
//   start ─► diff ─► files (skip binary/deleted/ignored) ─► units
//                                                            │
//   run: overview pass (1 call) ─► units in parallel (≤ model concurrency)
//        each unit = file chunk × pass, its findings saved as it finishes
//        ─► dedupe per file ─► status
//
// Units persist, so cancel, crash or failure resume with only what's left.

type SnapshotCategory = RulesSnapshot["categories"][number];

// Share of the context window for the prompt; the rest is left for output.
const PROMPT_SHARE = 0.6;
// Overview is a cheap summary; cap its prompt whatever the window.
const OVERVIEW_BUDGET = 6000;
// Room kept for the overview summary when sizing chunks.
const SUMMARY_RESERVE = 400;
const MAX_ERROR_LENGTH = 500;
const RULE_KEY = /^R?(\d+)$/i;
// Lines around each usage, so the reviewer sees what the caller does with it.
const USAGE_CONTEXT_LINES = 3;
// Per identifier, so a widely used name can't flood the prompt.
const MAX_USAGE_LINES = 60;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const NO_USAGE: Usage = { input: 0, output: 0 };

const controllers = new Map<number, AbortController>();

type RunContext = {
  review: Review;
  project: Project;
  snapshot: RulesSnapshot;
  model: ResolvedModel;
  signal: AbortSignal;
};

export function isRunning(reviewId: number): boolean {
  return controllers.has(reviewId);
}

// --- start -----------------------------------------------------------------

// ruleIds: exactly these rules (from a rule set or picked for this review);
// null = the project's enabled rules.
export async function startReview(projectId: number, source: DiffSource, ruleIds: number[] | null): Promise<number> {
  const project = projectById(projectId);
  if (!project) {
    throw new InputError("Unknown project");
  }

  const model = resolveModel(project.modelId);
  const resolved = await resolveSource(project.path, source);
  const parsed = await loadDiff(project.path, resolved);
  if (parsed.length === 0) {
    throw new InputError("No changes to review");
  }

  const only = z.array(z.number().int()).nullable().parse(ruleIds);
  const snapshot = effectiveRules(projectId, only && new Set(only));
  if (snapshot.categories.length === 0) {
    throw new InputError(only ? "None of the chosen rules apply to this project" : "No enabled rules for this project");
  }

  const review = insertReview({
    projectId,
    mode: source.mode,
    base: source.base,
    head: source.head,
    ...resolved,
    modelId: model.model.id,
    modelLabel: model.label,
    status: ReviewStatus.Running,
    rules: JSON.stringify(snapshot),
  });

  const ignored = ignoreMatcher(project);
  const rows = insertFiles(
    parsed.map((f) => {
      const skip = skipReason(f, ignored);
      return {
        reviewId: review.id,
        path: f.path,
        oldPath: f.oldPath,
        change: f.change,
        patch: f.patch,
        hash: hash(f.patch),
        state: skip ? FileState.Skipped : FileState.Queued,
        skipReason: skip,
      };
    }),
  );

  planUnits(review, project, snapshot, model, rows.filter((r) => r.state === FileState.Queued));
  launch(review.id);
  return review.id;
}

function ignoreMatcher(project: Project): (path: string) => boolean {
  const globs = [...splitGlobs(getSettings().ignoreGlobs), ...splitGlobs(project.ignoreGlobs)];
  return globs.length ? picomatch(globs, { dot: true }) : () => false;
}

function skipReason(f: ParsedFile, ignored: (path: string) => boolean): string | null {
  if (f.binary) {
    return "Binary file";
  }

  if (f.change === FileChange.Deleted) {
    return "Deleted file";
  }

  if (ignored(f.path)) {
    return "Matches an ignore glob";
  }

  if (f.hunks.length === 0) {
    return "No content changes";
  }

  return null;
}

function hash(text: string): string {
  return crypto.createHash("sha1").update(text).digest("hex");
}

// --- planning --------------------------------------------------------------

// Units for each file: one per pass, split into chunks that fit the model.
//   passes: Bugs alone; custom categories together, or one pass each when
//   their rule count exceeds the threshold.
function planUnits(
  review: Review,
  project: Project,
  snapshot: RulesSnapshot,
  model: ResolvedModel,
  files: ReviewFile[],
): void {
  const threshold = getSettings().passThreshold;
  const budget = Math.floor(model.model.contextWindow * PROMPT_SHARE);

  const units = files.flatMap((file) => {
    const parsed = parseDiff(file.patch)[0];
    const categories = snapshot.categories.filter((c) => appliesTo(c, file.path));

    return passes(categories, threshold).flatMap((pass) => {
      const room = budget - unitOverhead(project.description, "", pass.categories) - SUMMARY_RESERVE;

      return chunkHunks(parsed, room).map((hunks, chunk) => ({
        reviewId: review.id,
        fileId: file.id,
        pass: pass.name,
        categoryIds: JSON.stringify(pass.categories.map((c) => c.id)),
        chunk,
        hunks: JSON.stringify(hunks),
        status: UnitStatus.Pending,
      }));
    });
  });

  insertUnits(units);
}

function appliesTo(c: SnapshotCategory, path: string): boolean {
  return c.globs.length === 0 || picomatch(c.globs, { dot: true })(path);
}

function passes(categories: SnapshotCategory[], threshold: number) {
  const bugs = categories.filter((c) => c.kind === CategoryKind.Bugs);
  const custom = categories.filter((c) => c.kind !== CategoryKind.Bugs);
  const ruleCount = custom.reduce((n, c) => n + c.rules.length, 0);

  const result = bugs.map((c) => ({ name: c.name, categories: [c] }));
  if (custom.length === 0) {
    return result;
  }

  if (ruleCount <= threshold) {
    return [...result, { name: "Rules", categories: custom }];
  }

  return [...result, ...custom.map((c) => ({ name: c.name, categories: [c] }))];
}

// Groups hunk indexes so each group's diff fits `room` tokens.
// A single oversized hunk still gets its own group.
function chunkHunks(file: ParsedFile, room: number): number[][] {
  const chunks: number[][] = [];
  let current: number[] = [];
  let used = 0;

  file.hunks.forEach((h, i) => {
    const size = hunkTokens(h);
    if (current.length > 0 && used + size > room) {
      chunks.push(current);
      current = [];
      used = 0;
    }

    current.push(i);
    used += size;
  });

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

// --- running ---------------------------------------------------------------

function launch(reviewId: number): void {
  if (controllers.has(reviewId)) {
    return;
  }

  const controller = new AbortController();
  controllers.set(reviewId, controller);
  updateReview(reviewId, { status: ReviewStatus.Running, error: null, finishedAt: null });

  run(reviewId, controller.signal)
    .catch((e) => {
      updateReview(reviewId, { status: ReviewStatus.Failed, error: errorText(e), finishedAt: new Date() });
    })
    .finally(() => controllers.delete(reviewId));
}

async function run(reviewId: number, signal: AbortSignal): Promise<void> {
  const review = reviewById(reviewId);
  const project = review && projectById(review.projectId);
  if (!review || !project) {
    return;
  }

  const ctx: RunContext = {
    review,
    project,
    snapshot: JSON.parse(review.rules),
    model: resolveModel(review.modelId),
    signal,
  };

  // Every call of this review counts against the model's cap.
  const limit = modelLimiter(ctx.model.model.id, ctx.model.model.maxConcurrency);
  const pending = unitsForReview(reviewId).filter((u) => u.status === UnitStatus.Pending);
  if (pending.length > 0 && !review.summary) {
    ctx.review = { ...review, summary: await limit(() => overview(ctx)) };
  }

  await Promise.all(pending.map((u) => limit(() => runUnit(ctx, u))));

  const touched = new Set(pending.map((u) => u.fileId));
  finishFiles(reviewId, touched);

  if (signal.aborted) {
    requeueRunningUnits(reviewId);
    updateReview(reviewId, { status: ReviewStatus.Canceled, finishedAt: new Date() });
    return;
  }

  const units = unitsForReview(reviewId);
  const failed = units.filter((u) => u.status === UnitStatus.Failed).length;
  updateReview(reviewId, {
    status: failed ? ReviewStatus.Failed : ReviewStatus.Done,
    error: failed ? `${failed} of ${units.length} units failed. Retry to run them again.` : null,
    finishedAt: new Date(),
  });
}

// One cheap call summarizing the whole change, so per-file units keep the
// big picture without seeing every diff.
async function overview(ctx: RunContext): Promise<string> {
  const files = filesForReview(ctx.review.id)
    .filter((f) => f.state !== FileState.Skipped)
    .map((f) => parseDiff(f.patch)[0]);

  const budget = Math.min(OVERVIEW_BUDGET, Math.floor(ctx.model.model.contextWindow * PROMPT_SHARE));
  const { instructions, prompt } = overviewPrompt(ctx.project.description, files, budget);

  try {
    const { text, usage } = await generatePlain(ctx.model.config, { instructions, prompt, signal: ctx.signal });
    addReviewTokens(ctx.review.id, usage.input, usage.output);
    updateReview(ctx.review.id, { summary: text.trim() });
    return text.trim();
  } catch (e) {
    if (ctx.signal.aborted) {
      throw e;
    }

    // Units still work without the overview, just with less context.
    console.error(`Review ${ctx.review.id}: overview failed`, e);
    return "";
  }
}

async function runUnit(ctx: RunContext, unit: ReviewUnit): Promise<void> {
  if (ctx.signal.aborted) {
    return;
  }

  updateUnit(unit.id, { status: UnitStatus.Running, error: null });

  try {
    const file = fileById(unit.fileId);
    if (!file) {
      return;
    }

    const parsed = parseDiff(file.patch)[0];
    const ids: number[] = JSON.parse(unit.categoryIds);
    const categories = ctx.snapshot.categories.filter((c) => ids.includes(c.id));
    const hunks = (JSON.parse(unit.hunks) as number[]).map((i) => parsed.hunks[i]).filter(Boolean);
    const kind = categories.some((c) => c.kind === CategoryKind.Bugs) ? PassKind.Bugs : PassKind.Rules;
    const content = await headContent(ctx.project.path, ctx.review.headSha, file.path);

    // Bugs pass also sees how other files use what this diff changes.
    const lookup = kind === PassKind.Bugs ? await lookupUsages(ctx, parsed, hunks) : { usages: "", usage: NO_USAGE };

    const { instructions, prompt } = unitPrompt({
      kind,
      description: ctx.project.description,
      summary: ctx.review.summary,
      categories,
      file: parsed,
      hunks,
      content,
      budget: Math.floor(ctx.model.model.contextWindow * PROMPT_SHARE),
      usages: lookup.usages,
    });
    updateUnit(unit.id, { prompt: `${instructions}\n\n---\n\n${prompt}` });

    const { object, usage: spent } = await generateObject(ctx.model.config, {
      instructions,
      prompt,
      schema: findingsSchema,
      signal: ctx.signal,
    });
    const usage = { input: spent.input + lookup.usage.input, output: spent.output + lookup.usage.output };

    const dismissed = findingsForFile(file.id).filter((f) => f.status === FindingStatus.Dismissed);
    insertFindings(toFindings(object.findings, { kind, categories, file, unit, content, dismissed }));

    updateUnit(unit.id, { status: UnitStatus.Done, inputTokens: usage.input, outputTokens: usage.output });
    addReviewTokens(ctx.review.id, usage.input, usage.output);
  } catch (e) {
    if (ctx.signal.aborted) {
      updateUnit(unit.id, { status: UnitStatus.Pending });
      return;
    }

    updateUnit(unit.id, { status: UnitStatus.Failed, error: errorText(e) });
  }
}

// Asks which identifiers the diff changes, then greps their usages in other
// files. e.g. balance() flips sign → PaymentService's `cents > remaining`.
async function lookupUsages(ctx: RunContext, file: ParsedFile, hunks: Hunk[]): Promise<{ usages: string; usage: Usage }> {
  try {
    const { instructions, prompt } = lookupPrompt(file, hunks);
    const { object, usage } = await generateObject(ctx.model.config, {
      instructions,
      prompt,
      schema: lookupSchema,
      signal: ctx.signal,
    });

    const names = [...new Set(object.identifiers.map((n) => n.trim()))]
      .filter((n) => IDENTIFIER.test(n))
      .slice(0, MAX_LOOKUPS);

    const blocks: string[] = [];
    for (const name of names) {
      const out = await wordUsages(ctx.project.path, name, ctx.review.headSha, USAGE_CONTEXT_LINES);

      // Groups ("--" separated) in this file are in the prompt already.
      const groups = out
        .trimEnd()
        .split("\n--\n")
        .filter((g) => g && !g.startsWith(`${file.path}:`) && !g.startsWith(`${file.path}-`));
      if (groups.length === 0) {
        continue;
      }

      const lines = groups.join("\n--\n").split("\n").slice(0, MAX_USAGE_LINES);
      blocks.push(`### ${name}\n${lines.join("\n")}`);
    }

    return { usages: blocks.join("\n\n"), usage };
  } catch (e) {
    if (ctx.signal.aborted) {
      throw e;
    }

    // The unit still works without usages, just blind to other files.
    console.error(`Review ${ctx.review.id}: usage lookup for ${file.path} failed`, e);
    return { usages: "", usage: NO_USAGE };
  }
}

type DraftContext = {
  kind: PassKind;
  categories: SnapshotCategory[];
  file: ReviewFile;
  unit: ReviewUnit;
  content: string | null;
  dismissed: Finding[];
};

// Keeps drafts that cite a real rule of this pass and whose quote exists in
// the file; re-anchors their lines on the quote. Skips repeats of findings
// the user already dismissed.
function toFindings(drafts: FindingDraft[], ctx: DraftContext): FindingInput[] {
  const rules = new Map(
    ctx.categories.flatMap((c) => c.rules.map((r) => [r.id, { categoryId: c.id, rule: r }] as const)),
  );
  const seen = new Set(ctx.dismissed.map((f) => dedupeKey(f.ruleId, f.quote)));
  const result: FindingInput[] = [];

  for (const d of drafts) {
    const id = Number(RULE_KEY.exec(d.rule.trim())?.[1]);
    const match = rules.get(id);
    if (!match) {
      continue;
    }

    if (ctx.kind === PassKind.Bugs && !d.failure?.trim()) {
      continue;
    }

    const span = ctx.content === null
      ? { start: d.startLine, end: d.endLine }
      : locate(ctx.content, d.quote, d.startLine);
    if (!span) {
      continue;
    }

    if (seen.has(dedupeKey(id, d.quote))) {
      continue;
    }

    result.push({
      reviewId: ctx.file.reviewId,
      fileId: ctx.file.id,
      unitId: ctx.unit.id,
      path: ctx.file.path,
      startLine: span.start,
      endLine: span.end,
      quote: d.quote,
      ruleId: id,
      categoryId: match.categoryId,
      // User-set severity wins; bug severity depends on the bug.
      severity: ctx.kind === PassKind.Bugs ? d.severity : match.rule.severity,
      confidence: ctx.kind === PassKind.Bugs ? d.confidence : null,
      title: d.title,
      explanation: d.explanation,
      failure: ctx.kind === PassKind.Bugs ? d.failure : null,
      replacement: d.replacement?.trim() ? d.replacement : null,
      status: FindingStatus.Open,
    });
  }

  return result;
}

function dedupeKey(ruleId: number, quote: string): string {
  return `${ruleId}|${quote.replace(/\s+/g, " ").trim()}`;
}

// Marks fully reviewed files and drops duplicate findings: same rule on
// overlapping lines (chunks and passes can repeat each other).
function finishFiles(reviewId: number, fileIds: Set<number>): void {
  const units = unitsForReview(reviewId);

  for (const fileId of fileIds) {
    const fileUnits = units.filter((u) => u.fileId === fileId);
    if (fileUnits.every((u) => u.status === UnitStatus.Done)) {
      updateFile(fileId, { state: FileState.Reviewed });
    }

    const open = findingsForFile(fileId)
      .filter((f) => f.status === FindingStatus.Open)
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

    const kept: Finding[] = [];
    const dropped: number[] = [];
    for (const f of open) {
      const dup = kept.some(
        (k) => k.ruleId === f.ruleId && k.startLine <= f.endLine && f.startLine <= k.endLine,
      );
      if (dup) {
        dropped.push(f.id);
        continue;
      }

      kept.push(f);
    }

    deleteFindings(dropped);
  }
}

function errorText(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.slice(0, MAX_ERROR_LENGTH);
}

// --- control ---------------------------------------------------------------

export function cancelReview(reviewId: number): void {
  controllers.get(reviewId)?.abort();
}

export function retryReview(reviewId: number): void {
  requireIdle(reviewId);
  resetFailedUnits(reviewId);
  launch(reviewId);
}

// Re-reads the diff. Unchanged files keep their findings; changed files get
// their findings re-anchored (or marked outdated) and state Changed.
export async function refreshReview(reviewId: number): Promise<{ changed: number; removed: number }> {
  const review = requireIdle(reviewId);
  const project = projectById(review.projectId);
  if (!project) {
    throw new InputError("Unknown project");
  }

  const resolved = await resolveSource(project.path, {
    mode: review.mode,
    base: review.base,
    head: review.head,
  });
  const parsed = await loadDiff(project.path, resolved);
  const rows = new Map(filesForReview(reviewId).map((f) => [f.path, f]));
  const ignored = ignoreMatcher(project);
  let changed = 0;

  for (const f of parsed) {
    const row = rows.get(f.path);
    rows.delete(f.path);
    const fileHash = hash(f.patch);
    if (row?.hash === fileHash) {
      continue;
    }

    changed++;
    const skip = skipReason(f, ignored);
    const fields = {
      oldPath: f.oldPath,
      change: f.change,
      patch: f.patch,
      hash: fileHash,
      state: skip ? FileState.Skipped : FileState.Changed,
      skipReason: skip,
    };

    if (!row) {
      insertFiles([{ reviewId, path: f.path, ...fields }]);
      continue;
    }

    updateFile(row.id, fields);
    await reanchor(project, resolved, row.id);
  }

  // Files no longer in the diff (reverted or committed).
  const savedFixes = new Set(undoableFixes(reviewId));
  for (const row of rows.values()) {
    deleteUnitsForFile(row.id);
    // Keep fixed findings and their backups reachable after refresh.
    deleteFindings(findingsForFile(row.id).filter((f) => !savedFixes.has(f.id)).map((f) => f.id));
    updateFile(row.id, { state: FileState.Skipped, skipReason: "No longer changed" });
  }

  updateReview(reviewId, { ...resolved });
  return { changed, removed: rows.size };
}

// Re-locates open findings of a file after it changed.
async function reanchor(project: Project, resolved: Resolved, fileId: number): Promise<void> {
  const file = fileById(fileId);
  if (!file) {
    return;
  }

  const content = await headContent(project.path, resolved.headSha, file.path);
  for (const f of findingsForFile(fileId)) {
    if (f.status !== FindingStatus.Open && f.status !== FindingStatus.Outdated) {
      continue;
    }

    const span = content === null ? null : locate(content, f.quote, f.startLine);
    if (!span) {
      updateFinding(f.id, { status: FindingStatus.Outdated });
      continue;
    }

    updateFinding(f.id, { status: FindingStatus.Open, startLine: span.start, endLine: span.end });
  }
}

// Reviews files whose diff changed since the last run. Their open findings
// are replaced; dismissed and fixed ones stay.
export function rereviewChanged(reviewId: number): number {
  const review = requireIdle(reviewId);
  const project = projectById(review.projectId);
  if (!project) {
    throw new InputError("Unknown project");
  }

  const changed = filesForReview(reviewId).filter((f) => f.state === FileState.Changed);
  if (changed.length === 0) {
    throw new InputError("No changed files to review");
  }

  for (const f of changed) {
    deleteOpenFindings(f.id);
    deleteUnitsForFile(f.id);
    updateFile(f.id, { state: FileState.Queued });
  }

  const model = resolveModel(review.modelId);
  planUnits(review, project, JSON.parse(review.rules), model, changed);
  updateReview(reviewId, { summary: "" });
  launch(reviewId);
  return changed.length;
}

function requireIdle(reviewId: number): Review {
  const review = reviewById(reviewId);
  if (!review) {
    throw new InputError("Unknown review");
  }

  if (controllers.has(reviewId)) {
    throw new InputError("Review is running");
  }

  return review;
}

// After a restart nothing is running: mark interrupted reviews resumable.
export function recoverInterrupted(): void {
  for (const r of reviewsWithStatus(ReviewStatus.Running)) {
    requeueRunningUnits(r.id);
    updateReview(r.id, {
      status: ReviewStatus.Failed,
      error: "Interrupted by a restart. Retry to resume.",
      finishedAt: new Date(),
    });
  }
}
