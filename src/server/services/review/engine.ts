import crypto from "node:crypto";
import picomatch from "picomatch";
import { z } from "zod";
import {
  CategoryKind,
  DiffMode,
  FileChange,
  FileState,
  FindingStatus,
  ReviewStatus,
  ruleKey,
  SEVERITY_RANK,
  UnitStatus,
} from "@/lib/domain";
import { wordUsages } from "@/server/drivers/git";
import { defineTool, generateAgentObject, generateAgentText, generateObject, generatePlain, type ChatTool, type Usage } from "@/server/drivers/llm";
import { undoableFixes } from "@/server/drivers/fixStore";
import { projectById } from "@/server/drivers/projectStore";
import {
  addReviewTokens,
  appendReviewTrace,
  appendUnitStep,
  deleteFindings,
  deleteOpenFindings,
  deleteUnitsForFile,
  fileById,
  filesForReview,
  findingsForFile,
  findingsForReview,
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
import {
  headContent,
  loadChanges,
  pastedFiles,
  pastedSchema,
  resolveSource,
  sourceSchema,
  type DiffSource,
  type PastedFile,
  type Resolved,
} from "../diff";
import { parseDiff, type ParsedFile } from "../diffParse";
import { InputError } from "../errors";
import { resolveModel, type ResolvedModel } from "../providers";
import { repoMap, repoTools, ToolScope } from "../repoTools";
import { effectiveRules, splitGlobs, type RulesSnapshot } from "../rules";
import { getSettings } from "../settings";
import { locate } from "./locate";
import { modelLimiter } from "./limiter";
import {
  conclusionPrompt,
  findingsSchema,
  hunkTokens,
  lookupPrompt,
  lookupSchema,
  MAX_FOLLOW_UPS,
  MAX_GROUP_FILES,
  MAX_LOOKUPS,
  orchestratorPrompt,
  PassKind,
  planPrompt,
  planSchema,
  unitOverhead,
  unitPrompt,
  type FindingDraft,
  type UnitFile,
} from "./prompts";
import { unitFileIds, unitHunks } from "./units";

// Review pipeline: an orchestrator agent leads reviewer agents.
//
//   start ─► diff ─► files (skip binary/deleted/ignored)
//
//   run, model with tool calling:
//     orchestrator agent ─► explores the repository
//                        ─► spawn_reviewers: overview + tasks (files,
//                           objective, out of scope) ─► units run in
//                           parallel, findings come back to it
//                        ─► reads doubtful findings ─► reject_findings
//                        ─► follow-up tasks on leads (bugs only)
//   run, model without: one planning call (overview + groups) ─► units
//
//   files left out of every task ─► grouped by directory ─► units
//   units: group × pass, split to fit; bugs pass with tool calling is an
//   agent reading callers, callees, types; else one call (+ grepped usages)
//   ─► dedupe per file ─► conclusion (1 call, when all units are done)
//   ─► status
//
// Units persist, so cancel, crash or failure resume with only what's left.
// Files without units (new review, re-review) are planned on the next run.

type SnapshotCategory = RulesSnapshot["categories"][number];

// Share of the context window for the prompt; the rest is left for output.
const PROMPT_SHARE = 0.6;
// Plan and conclusion are summaries; cap their prompts whatever the window.
const PLAN_BUDGET = 16_000;
const CONCLUSION_BUDGET = 8000;
// Agent units start smaller: tool results fill the rest of the window.
const AGENT_PROMPT_SHARE = 0.35;
// The agent must answer once its conversation fills this share.
const AGENT_CONTEXT_SHARE = 0.8;
// Tool rounds per agent unit, the last one being the answer.
const AGENT_STEPS = 12;
// Orchestrator tool rounds: exploring, spawning, checking, following up.
const ORCHESTRATOR_STEPS = 24;
// Findings listed back to the orchestrator per spawn, most severe first.
const MAX_REPORTED_FINDINGS = 80;
const REPORTED_FAILURE_CHARS = 160;
// Repository map in agent prompts, in characters.
const AGENT_MAP_CHARS = 4000;
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
// null = the project's enabled rules. pasted: the files of a Pasted review.
export async function startReview(
  projectId: number,
  input: DiffSource,
  ruleIds: number[] | null,
  pasted: PastedFile[] = [],
): Promise<number> {
  const project = projectById(projectId);
  if (!project) {
    throw new InputError("Unknown project");
  }

  const source = sourceSchema.parse(input);
  const model = resolveModel(project.modelId);
  const resolved = await resolveSource(project.path, source);
  const parsed =
    source.mode === DiffMode.Pasted ? pastedFiles(pastedSchema.parse(pasted)) : await loadChanges(project.path, source, resolved);
  if (parsed.length === 0) {
    throw new InputError(source.mode === DiffMode.Files || source.mode === DiffMode.Pasted ? "Nothing to review" : "No changes to review");
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
    paths: source.paths && JSON.stringify(source.paths),
    ...resolved,
    modelId: model.model.id,
    modelLabel: model.label,
    status: ReviewStatus.Running,
    rules: JSON.stringify(snapshot),
  });

  const ignored = ignoreMatcher(project);
  insertFiles(
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

// A set of files reviewed together. title/focus: from the orchestrator,
// null for fallback groups.
type Group = { title: string | null; focus: string | null; files: ReviewFile[] };

// The orchestrator's call: overview of the whole change, then groups for
// `files` (the unplanned ones). Files it leaves out are grouped by directory.
async function plan(ctx: RunContext, files: ReviewFile[]): Promise<Group[]> {
  const all = filesForReview(ctx.review.id).filter((f) => f.state !== FileState.Skipped);
  const budget = Math.min(PLAN_BUDGET, Math.floor(ctx.model.model.contextWindow * PROMPT_SHARE));
  const { instructions, prompt } = planPrompt(ctx.project.description, all.map((f) => parseDiff(f.patch)[0]), budget);

  try {
    const { object, usage } = await generateObject(ctx.model.config, { instructions, prompt, schema: planSchema, signal: ctx.signal });
    addReviewTokens(ctx.review.id, usage.input, usage.output);
    const overview = object.overview.trim();
    updateReview(ctx.review.id, { summary: overview });
    ctx.review = { ...ctx.review, summary: overview };
    return groupsFromPlan(object.groups, files);
  } catch (e) {
    if (ctx.signal.aborted) {
      throw e;
    }

    // Units still work without the plan, with less context.
    console.error(`Review ${ctx.review.id}: planning failed`, e);
    return directoryGroups(files);
  }
}

// The orchestrator agent. Its tools are the repository tools plus its
// team: spawn_reviewers runs units and reports their findings back,
// reject_findings drops false positives. Its activity and decisions are
// stored on the review, for the agents view. Not counted against the
// model's concurrency: it waits while its reviewers run, so holding a
// slot would deadlock a model limited to one request.
async function orchestrate(ctx: RunContext, limit: <T>(task: () => Promise<T>) => Promise<T>, unplanned: ReviewFile[], map: string): Promise<void> {
  const reviewId = ctx.review.id;
  const all = filesForReview(reviewId).filter((f) => f.state !== FileState.Skipped);
  const budget = Math.min(PLAN_BUDGET, Math.floor(ctx.model.model.contextWindow * AGENT_PROMPT_SHARE));
  const { instructions, prompt } = orchestratorPrompt(
    ctx.project.description,
    all.map((f) => parseDiff(f.patch)[0]),
    unplanned.map((f) => f.path),
    map,
    budget,
  );

  const say = (activity: string | null) => updateReview(reviewId, { activity });
  const log = (line: string) => appendReviewTrace(reviewId, line);
  const team = { ctx, limit, map, all, followUps: 0, log, say };

  say("Reading the change");
  try {
    const { text, usage } = await generateAgentText(ctx.model.config, {
      instructions: `${instructions}\n- You have about ${ORCHESTRATOR_STEPS} tool rounds, including waiting for reviewers.`,
      prompt,
      tools: { ...repoTools({ project: ctx.project, review: ctx.review }, ToolScope.Review), ...teamTools(team) },
      budget: { steps: ORCHESTRATOR_STEPS, contextTokens: Math.floor(ctx.model.model.contextWindow * AGENT_CONTEXT_SHARE) },
      signal: ctx.signal,
      onTool: (name, input) => {
        if (name in TEAM_TOOLS) {
          return;
        }

        say(toolActivity(name, input));
        log(`Explored: ${toolActivity(name, input)}`);
      },
    });
    addReviewTokens(reviewId, usage.input, usage.output);
    if (text.trim()) {
      log(`Summary: ${text.trim()}`);
    }
  } catch (e) {
    if (ctx.signal.aborted) {
      return;
    }

    // Remaining files are reviewed by directory, without briefs.
    console.error(`Review ${reviewId}: orchestrator failed`, e);
    log(`Orchestrator stopped: ${errorText(e)}. Remaining files are reviewed by directory.`);
  } finally {
    say(null);
  }
}

// Names of the orchestrator's own tools, to tell them from repository tools.
const TEAM_TOOLS = { spawn_reviewers: true, reject_findings: true };

type Team = {
  ctx: RunContext;
  limit: <T>(task: () => Promise<T>) => Promise<T>;
  map: string;
  all: ReviewFile[];
  followUps: number;
  log: (line: string) => void;
  say: (activity: string | null) => void;
};

function teamTools(team: Team): Record<keyof typeof TEAM_TOOLS, ChatTool> {
  return {
    spawn_reviewers: defineTool({
      description:
        "Start reviewer agents, one per task, and wait for them. Returns their findings. Pass the overview on the first call. Call once with every task; later calls are follow-ups.",
      input: z.object({
        overview: z.string().nullable().describe("At most 150 words for every reviewer: what the change does, cross-file relationships"),
        tasks: z
          .array(
            z.object({
              title: z.string().describe("2 to 5 words, e.g. Refund calculation"),
              files: z.array(z.string()).min(1).describe(`Changed files, paths as listed; at most ${MAX_GROUP_FILES}`),
              objective: z.string().describe("Self-contained brief: what changed, what could break, where to look, the question to answer"),
              outOfScope: z.string().nullable().describe("What other reviewers cover"),
              scope: z.enum(TaskScope).describe('"full" for a first review, "bugs" for a follow-up'),
            }),
          )
          .min(1),
      }),
      run: (input) => spawnReviewers(team, input),
    }),
    reject_findings: defineTool({
      description: "Drop findings you checked against the code and found false. They are removed from the report; the reason is logged.",
      input: z.object({
        ids: z.array(z.number().int()).min(1).describe("Finding ids, e.g. [12, 15]"),
        reason: z.string().describe("One line: why the code proves them wrong"),
      }),
      run: async ({ ids, reason }) => rejectFindings(team, ids, reason),
    }),
  };
}

type TaskInput = { title: string; files: string[]; objective: string; outOfScope: string | null; scope: TaskScope };

// Runs the tasks' units in parallel, then reports what each found:
//   ## Refund flow (2 reviewers done)
//   #12 major R1 src/pay.ts:40 Sign flips — failure: refund(−5) → charges 5 (possible)
async function spawnReviewers(team: Team, input: { overview: string | null; tasks: TaskInput[] }): Promise<string> {
  const { ctx } = team;
  const reviewId = ctx.review.id;
  if (input.overview?.trim()) {
    const overview = input.overview.trim();
    updateReview(reviewId, { summary: overview });
    ctx.review = { ...ctx.review, summary: overview };
  }

  const byPath = new Map(team.all.map((f) => [f.path, f]));
  const unknown: string[] = [];
  const spawned: { task: TaskInput; units: ReviewUnit[] }[] = [];

  for (const task of input.tasks) {
    if (task.scope === TaskScope.Bugs && team.followUps >= MAX_FOLLOW_UPS) {
      unknown.push(`${task.title}: follow-up limit reached (${MAX_FOLLOW_UPS})`);
      continue;
    }

    const rows = task.files.flatMap((p) => {
      const row = byPath.get(p.trim()) ?? team.all.find((f) => f.path.endsWith(`/${p.trim()}`));
      if (!row) {
        unknown.push(p);
      }

      return row ? [row] : [];
    });
    if (rows.length === 0) {
      continue;
    }

    if (task.scope === TaskScope.Bugs) {
      team.followUps++;
    }

    const focus = [task.objective.trim(), task.outOfScope?.trim() ? `Out of scope: ${task.outOfScope.trim()}` : ""].filter(Boolean).join("\n");
    const title = task.scope === TaskScope.Bugs ? `Follow-up: ${task.title.trim()}` : task.title.trim();
    const groups: Group[] = [];
    for (let i = 0; i < rows.length; i += MAX_GROUP_FILES) {
      groups.push({ title, focus, files: rows.slice(i, i + MAX_GROUP_FILES) });
    }

    const units = planUnits(ctx.review, ctx.project, ctx.snapshot, ctx.model, groups, task.scope);
    spawned.push({ task, units });
    // Files and brief show on the reviewer's row in the agents view.
    team.log(`Spawned "${title}" (${task.scope}, ${rows.length} ${rows.length === 1 ? "file" : "files"})`);
  }

  const units = spawned.flatMap((s) => s.units);
  team.say(`Waiting for ${units.length} ${units.length === 1 ? "reviewer" : "reviewers"}`);
  await Promise.all(units.map((u) => team.limit(() => runUnit(ctx, u, team.map))));
  finishFiles(reviewId, new Set(units.flatMap(unitFileIds)));
  team.say("Checking the findings");

  const sections = spawned.map(({ task, units: own }) => taskReport(task, own));
  const problems = unknown.length > 0 ? `\n\nNot started: ${unknown.join(", ")} (not among the changed files).` : "";
  return (sections.join("\n\n") || "No task started.") + problems;
}

function taskReport(task: TaskInput, units: ReviewUnit[]): string {
  const ids = new Set(units.map((u) => u.id));
  const failed = unitsForReview(units[0]?.reviewId ?? 0).filter((u) => ids.has(u.id) && u.status === UnitStatus.Failed);
  const found = findingsForReview(units[0]?.reviewId ?? 0)
    .filter((f) => f.unitId !== null && ids.has(f.unitId) && f.status === FindingStatus.Open)
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  const lines = found.slice(0, MAX_REPORTED_FINDINGS).map((f) => {
    const failure = f.failure ? ` · failure: ${f.failure.slice(0, REPORTED_FAILURE_CHARS)}` : "";
    const confidence = f.confidence ? ` (${f.confidence})` : "";
    return `#${f.id} ${f.severity} ${ruleKey(f.ruleId)} ${f.path}:${f.startLine} ${f.title}${failure}${confidence}`;
  });
  if (found.length > MAX_REPORTED_FINDINGS) {
    lines.push(`… ${found.length - MAX_REPORTED_FINDINGS} more, less severe`);
  }

  const status = failed.length > 0 ? `${failed.length} of ${units.length} reviewers failed` : `${units.length} reviewers done`;
  return `## ${task.title} (${status})\n${lines.join("\n") || "No findings."}`;
}

function rejectFindings(team: Team, ids: number[], reason: string): string {
  const reviewId = team.ctx.review.id;
  const open = new Map(
    findingsForReview(reviewId)
      .filter((f) => f.status === FindingStatus.Open)
      .map((f) => [f.id, f]),
  );
  const rejected = ids.filter((id) => open.has(id));
  const missing = ids.filter((id) => !open.has(id));

  deleteFindings(rejected);
  for (const id of rejected) {
    const f = open.get(id)!;
    team.log(`Rejected #${id} (${f.path}:${f.startLine} ${f.title}): ${reason.trim()}`);
  }

  team.say("Checking the findings");
  const done = rejected.length > 0 ? `Rejected ${rejected.map((id) => `#${id}`).join(", ")}.` : "Nothing rejected.";
  return missing.length > 0 ? `${done} Not open findings of this review: ${missing.map((id) => `#${id}`).join(", ")}.` : done;
}

// Planner groups mapped to file rows: unknown paths and repeats dropped,
// oversized groups split, leftovers grouped by directory.
function groupsFromPlan(planned: { title: string; files: string[]; focus: string }[], files: ReviewFile[]): Group[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const taken = new Set<number>();
  const groups: Group[] = [];

  for (const g of planned) {
    const rows = g.files.flatMap((p) => byPath.get(p.trim()) ?? []).filter((f) => !taken.has(f.id));
    if (rows.length === 0) {
      continue;
    }

    rows.forEach((f) => taken.add(f.id));
    for (let i = 0; i < rows.length; i += MAX_GROUP_FILES) {
      groups.push({ title: g.title.trim() || null, focus: g.focus.trim() || null, files: rows.slice(i, i + MAX_GROUP_FILES) });
    }
  }

  return [...groups, ...directoryGroups(files.filter((f) => !taken.has(f.id)))];
}

// Fallback: files of a directory together, e.g. src/pay/a.ts + src/pay/b.ts.
function directoryGroups(files: ReviewFile[]): Group[] {
  const byDir = new Map<string, ReviewFile[]>();
  for (const f of files) {
    const dir = f.path.slice(0, f.path.lastIndexOf("/") + 1);
    byDir.set(dir, [...(byDir.get(dir) ?? []), f]);
  }

  return [...byDir.values()].flatMap((rows) => {
    const groups: Group[] = [];
    for (let i = 0; i < rows.length; i += MAX_GROUP_FILES) {
      groups.push({ title: null, focus: null, files: rows.slice(i, i + MAX_GROUP_FILES) });
    }

    return groups;
  });
}

// What a group is reviewed for: every pass, or bugs only (follow-ups).
enum TaskScope {
  Full = "full",
  Bugs = "bugs",
}

// Units for each group: one per pass, split so each prompt fits the model.
//   passes: Bugs alone; custom categories together, or one pass each when
//   their rule count exceeds the threshold.
//   split: the group's files packed by diff size; a file too big alone is
//   chunked by hunks.
function planUnits(
  review: Review,
  project: Project,
  snapshot: RulesSnapshot,
  model: ResolvedModel,
  groups: Group[],
  scope: TaskScope,
): ReviewUnit[] {
  const threshold = getSettings().passThreshold;
  const window = model.model.contextWindow;

  const units = groups.flatMap((group) => {
    const categories = snapshot.categories.filter((c) => group.files.some((f) => appliesTo(c, f.path)));

    const wanted = passes(categories, threshold).filter((p) => scope === TaskScope.Full || p.categories.some((c) => c.kind === CategoryKind.Bugs));
    return wanted.flatMap((pass) => {
      const files = group.files.filter((f) => pass.categories.some((c) => appliesTo(c, f.path)));
      const agent = model.model.toolCalling && pass.categories.some((c) => c.kind === CategoryKind.Bugs);
      const share = agent ? AGENT_PROMPT_SHARE : PROMPT_SHARE;
      const room = Math.floor(window * share) - unitOverhead(project.description, "", pass.categories) - SUMMARY_RESERVE;

      return packFiles(files, room).map((pack) => ({
        reviewId: review.id,
        fileId: pack.files[0].id,
        fileIds: pack.files.length > 1 ? JSON.stringify(pack.files.map((f) => f.id)) : null,
        title: group.title,
        focus: group.focus,
        pass: pass.name,
        categoryIds: JSON.stringify(pass.categories.map((c) => c.id)),
        chunk: pack.chunk,
        hunks: JSON.stringify(pack.files.length > 1 ? Object.fromEntries(pack.files.map((f) => [f.id, pack.hunks.get(f.id)])) : pack.hunks.get(pack.files[0].id)),
        agent,
        status: UnitStatus.Pending,
      }));
    });
  });

  return insertUnits(units);
}

type Pack = { files: ReviewFile[]; hunks: Map<number, number[]>; chunk: number };

// Files packed into prompts of at most `room` diff tokens.
//   [a 2k, b 1k, c 9k] with room 4k → [a, b] · [c part 1] · [c part 2]
function packFiles(files: ReviewFile[], room: number): Pack[] {
  const packs: Pack[] = [];
  let current: Pack = { files: [], hunks: new Map(), chunk: 0 };
  let used = 0;

  for (const file of files) {
    const parsed = parseDiff(file.patch)[0];
    const size = parsed.hunks.reduce((n, h) => n + hunkTokens(h), 0);
    const all = parsed.hunks.map((_, i) => i);

    if (size > room) {
      chunkHunks(parsed, room).forEach((hunks, chunk) => packs.push({ files: [file], hunks: new Map([[file.id, hunks]]), chunk }));
      continue;
    }

    if (current.files.length > 0 && used + size > room) {
      packs.push(current);
      current = { files: [], hunks: new Map(), chunk: 0 };
      used = 0;
    }

    current.files.push(file);
    current.hunks.set(file.id, all);
    used += size;
  }

  if (current.files.length > 0) {
    packs.push(current);
  }

  return packs;
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

  const map = ctx.model.model.toolCalling ? await repoMap({ project, review }, AGENT_MAP_CHARS) : "";

  // Queued files without units: new review, or re-review of changed files.
  const planned = new Set(unitsForReview(reviewId).flatMap(unitFileIds));
  const unplanned = filesForReview(reviewId).filter((f) => f.state === FileState.Queued && !planned.has(f.id));
  if (unplanned.length > 0) {
    if (ctx.model.model.toolCalling) {
      await orchestrate(ctx, limit, unplanned, map);
    } else {
      const groups = await limit(() => plan(ctx, unplanned));
      planUnits(ctx.review, project, ctx.snapshot, ctx.model, groups, TaskScope.Full);
    }

    if (signal.aborted) {
      requeueRunningUnits(reviewId);
      updateReview(reviewId, { status: ReviewStatus.Canceled, activity: null, finishedAt: new Date() });
      return;
    }

    // Files no task covered, grouped by directory.
    const tasked = new Set(unitsForReview(reviewId).flatMap(unitFileIds));
    const leftover = unplanned.filter((f) => !tasked.has(f.id));
    planUnits(ctx.review, project, ctx.snapshot, ctx.model, directoryGroups(leftover), TaskScope.Full);

    // No pass applies, e.g. every category's globs exclude the file.
    const covered = new Set(unitsForReview(reviewId).flatMap(unitFileIds));
    for (const f of leftover.filter((f) => !covered.has(f.id))) {
      updateFile(f.id, { state: FileState.Skipped, skipReason: "No rules apply to this file" });
    }
  }

  const pending = unitsForReview(reviewId).filter((u) => u.status === UnitStatus.Pending);
  await Promise.all(pending.map((u) => limit(() => runUnit(ctx, u, map))));

  const touched = new Set(pending.flatMap(unitFileIds));
  finishFiles(reviewId, touched);

  if (signal.aborted) {
    requeueRunningUnits(reviewId);
    updateReview(reviewId, { status: ReviewStatus.Canceled, finishedAt: new Date() });
    return;
  }

  const units = unitsForReview(reviewId);
  const failed = units.filter((u) => u.status === UnitStatus.Failed).length;

  // Written before the status flips, so the report polls until it lands.
  if (!failed && units.length > 0 && !review.conclusion) {
    await limit(() => conclude(ctx)).catch((e) => {
      if (signal.aborted) {
        return;
      }

      // The report still shows its findings without the recap.
      console.error(`Review ${reviewId}: conclusion failed`, e);
    });
  }

  updateReview(reviewId, {
    status: failed ? ReviewStatus.Failed : ReviewStatus.Done,
    error: failed ? `${failed} of ${units.length} units failed. Retry to run them again.` : null,
    finishedAt: new Date(),
  });
}

// One call recapping the open findings: verdict and what to fix first.
async function conclude(ctx: RunContext): Promise<void> {
  const reviewId = ctx.review.id;
  const rules = new Map(ctx.snapshot.categories.flatMap((c) => c.rules.map((r) => [r.id, r.name] as const)));
  const files = filesForReview(reviewId)
    .filter((f) => f.state === FileState.Reviewed)
    .map((f) => f.path);
  const open = findingsForReview(reviewId)
    .filter((f) => f.status === FindingStatus.Open)
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .map((f) => ({
      id: f.id,
      severity: f.severity,
      rule: `${ruleKey(f.ruleId)} ${rules.get(f.ruleId) ?? ""}`.trim(),
      path: f.path,
      line: f.startLine,
      title: f.title,
      explanation: f.explanation,
    }));

  const budget = Math.min(CONCLUSION_BUDGET, Math.floor(ctx.model.model.contextWindow * PROMPT_SHARE));
  const { instructions, prompt } = conclusionPrompt(ctx.review.summary, files, open, budget);
  const { text, usage } = await generatePlain(ctx.model.config, { instructions, prompt, signal: ctx.signal });
  addReviewTokens(reviewId, usage.input, usage.output);
  updateReview(reviewId, { conclusion: text.trim() });
}

// One unit: its files' diffs and new versions, reviewed by an agent
// (bugs pass, tool calling) or in one call. Findings land as it ends.
async function runUnit(ctx: RunContext, unit: ReviewUnit, map: string): Promise<void> {
  if (ctx.signal.aborted) {
    return;
  }

  updateUnit(unit.id, { status: UnitStatus.Running, error: null, activity: null, steps: "" });

  try {
    const files = await unitFiles(ctx, unit);
    if (files.length === 0) {
      return;
    }

    const ids: number[] = JSON.parse(unit.categoryIds);
    const categories = ctx.snapshot.categories.filter((c) => ids.includes(c.id));
    const kind = categories.some((c) => c.kind === CategoryKind.Bugs) ? PassKind.Bugs : PassKind.Rules;
    const agentic = unit.agent && kind === PassKind.Bugs && ctx.model.model.toolCalling;

    const result = agentic
      ? await agentReview(ctx, unit, files, categories, map).catch((e: unknown) => {
          if (ctx.signal.aborted) {
            throw e;
          }

          // e.g. the provider rejects tools with JSON output: one-shot instead.
          console.error(`Review ${ctx.review.id}: agent unit ${unit.id} failed, retrying without tools`, e);
          return directReview(ctx, unit, files, categories, kind);
        })
      : await directReview(ctx, unit, files, categories, kind);

    insertFindings(toFindings(result.drafts, { kind, categories, files, unit }));
    updateUnit(unit.id, {
      status: UnitStatus.Done,
      activity: null,
      inputTokens: result.usage.input,
      outputTokens: result.usage.output,
    });
    addReviewTokens(ctx.review.id, result.usage.input, result.usage.output);
  } catch (e) {
    if (ctx.signal.aborted) {
      updateUnit(unit.id, { status: UnitStatus.Pending, activity: null });
      return;
    }

    updateUnit(unit.id, { status: UnitStatus.Failed, activity: null, error: errorText(e) });
  }
}

type UnitResult = { drafts: FindingDraft[]; usage: Usage };

type LoadedFile = UnitFile & { row: ReviewFile };

async function unitFiles(ctx: RunContext, unit: ReviewUnit): Promise<LoadedFile[]> {
  const loaded: LoadedFile[] = [];
  for (const [fileId, indexes] of unitHunks(unit)) {
    const row = fileById(fileId);
    if (!row) {
      continue;
    }

    const file = parseDiff(row.patch)[0];
    const hunks = indexes.map((i) => file.hunks[i]).filter(Boolean);
    // Pasted files exist only in their patch, which holds them whole.
    const content = ctx.review.mode === DiffMode.Pasted ? null : await headContent(ctx.project.path, ctx.review.headSha, row.path);
    loaded.push({ row, file, hunks, content });
  }

  return loaded;
}

// Bugs pass with tools: the model reads callers, callees and types of the
// reviewed version before reporting. Its steps show live in the report.
async function agentReview(
  ctx: RunContext,
  unit: ReviewUnit,
  files: LoadedFile[],
  categories: SnapshotCategory[],
  map: string,
): Promise<UnitResult> {
  const mine = new Set(files.map((f) => f.row.id));
  const otherFiles = filesForReview(ctx.review.id)
    .filter((f) => !mine.has(f.id) && f.state !== FileState.Skipped)
    .map((f) => f.path);

  const { instructions, prompt } = unitPrompt({
    kind: PassKind.Bugs,
    description: ctx.project.description,
    summary: ctx.review.summary,
    focus: unit.focus ?? "",
    categories,
    files,
    budget: Math.floor(ctx.model.model.contextWindow * AGENT_PROMPT_SHARE),
    usages: "",
    agent: { steps: AGENT_STEPS, repoMap: map, otherFiles },
  });
  const sent = `${instructions}\n\n---\n\n${prompt}`;
  updateUnit(unit.id, { prompt: sent, activity: "Reading the diff" });

  const { object, usage, trace } = await generateAgentObject(ctx.model.config, {
    instructions,
    prompt,
    schema: findingsSchema,
    tools: repoTools({ project: ctx.project, review: ctx.review }, ToolScope.Review),
    budget: { steps: AGENT_STEPS, contextTokens: Math.floor(ctx.model.model.contextWindow * AGENT_CONTEXT_SHARE) },
    signal: ctx.signal,
    onTool: (name, input) => {
      const step = toolActivity(name, input);
      updateUnit(unit.id, { activity: step });
      appendUnitStep(unit.id, step);
    },
  });

  const steps = trace.length > 0 ? trace.map((t) => `- ${t}`).join("\n") : "(none)";
  updateUnit(unit.id, { prompt: `${sent}\n\n---\n\n## Agent tool calls\n${steps}` });
  return { drafts: object.findings, usage };
}

// "Reading pay.ts:40-90", "Searching refund in *.java", for the live view.
function toolActivity(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const where = i.glob ? ` in ${i.glob}` : "";
  const range = i.startLine ? `:${i.startLine}-${i.endLine ?? ""}` : "";
  const labels: Record<string, string> = {
    read_file: `Reading ${i.path}${range}`,
    read_symbol: `Reading ${i.name}${i.path ? ` in ${i.path}` : ""}`,
    search: `Searching ${i.pattern}${where}`,
    find_usages: `Finding usages of ${i.identifier}${where}`,
    outline: `Outlining ${i.path}`,
    list_files: `Listing ${i.glob}`,
  };
  return labels[name] ?? `Running ${name}`;
}

// One call with the unit's diffs. The bugs pass first greps usages of
// what the diff changes, so it isn't blind to other files.
async function directReview(
  ctx: RunContext,
  unit: ReviewUnit,
  files: LoadedFile[],
  categories: SnapshotCategory[],
  kind: PassKind,
): Promise<UnitResult> {
  updateUnit(unit.id, { activity: kind === PassKind.Bugs ? "Looking up usages" : "Waiting for the model" });
  if (kind === PassKind.Bugs) {
    appendUnitStep(unit.id, "Looking up usages of what the diff changes");
  }

  const lookup = kind === PassKind.Bugs ? await lookupUsages(ctx, files) : { usages: "", usage: NO_USAGE };

  const { instructions, prompt } = unitPrompt({
    kind,
    description: ctx.project.description,
    summary: ctx.review.summary,
    focus: unit.focus ?? "",
    categories,
    files,
    budget: Math.floor(ctx.model.model.contextWindow * PROMPT_SHARE),
    usages: lookup.usages,
    agent: null,
  });
  updateUnit(unit.id, { prompt: `${instructions}\n\n---\n\n${prompt}`, activity: "Waiting for the model" });

  const { object, usage } = await generateObject(ctx.model.config, {
    instructions,
    prompt,
    schema: findingsSchema,
    signal: ctx.signal,
  });
  return { drafts: object.findings, usage: { input: usage.input + lookup.usage.input, output: usage.output + lookup.usage.output } };
}

// Asks which identifiers the diff changes, then greps their usages in other
// files. e.g. balance() flips sign → PaymentService's `cents > remaining`.
async function lookupUsages(ctx: RunContext, files: LoadedFile[]): Promise<{ usages: string; usage: Usage }> {
  try {
    const { instructions, prompt } = lookupPrompt(files);
    const { object, usage } = await generateObject(ctx.model.config, {
      instructions,
      prompt,
      schema: lookupSchema,
      signal: ctx.signal,
    });

    const names = [...new Set(object.identifiers.map((n) => n.trim()))]
      .filter((n) => IDENTIFIER.test(n))
      .slice(0, MAX_LOOKUPS);
    const own = files.map((f) => f.row.path);

    const blocks: string[] = [];
    for (const name of names) {
      const out = await wordUsages(ctx.project.path, name, ctx.review.headSha, USAGE_CONTEXT_LINES);

      // Groups ("--" separated) in this unit's files are in the prompt already.
      const groups = out
        .trimEnd()
        .split("\n--\n")
        .filter((g) => g && !own.some((p) => g.startsWith(`${p}:`) || g.startsWith(`${p}-`)));
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
    console.error(`Review ${ctx.review.id}: usage lookup for unit failed`, e);
    return { usages: "", usage: NO_USAGE };
  }
}

type DraftContext = {
  kind: PassKind;
  categories: SnapshotCategory[];
  files: LoadedFile[];
  unit: ReviewUnit;
};

// Keeps drafts on one of the unit's files, citing a real rule of this pass
// that applies to that file, whose quote exists in it; re-anchors their
// lines on the quote. Skips repeats of findings the user already dismissed.
function toFindings(drafts: FindingDraft[], ctx: DraftContext): FindingInput[] {
  const rules = new Map(
    ctx.categories.flatMap((c) => c.rules.map((r) => [r.id, { category: c, rule: r }] as const)),
  );
  const seen = new Set(
    ctx.files.flatMap((f) => findingsForFile(f.row.id).filter((x) => x.status === FindingStatus.Dismissed)).map((f) => dedupeKey(f.ruleId, f.quote)),
  );
  const result: FindingInput[] = [];

  for (const d of drafts) {
    const id = Number(RULE_KEY.exec(d.rule.trim())?.[1]);
    const match = rules.get(id);
    const file = draftFile(d, ctx.files);
    if (!match || !file || !appliesTo(match.category, file.row.path)) {
      continue;
    }

    if (ctx.kind === PassKind.Bugs && !d.failure?.trim()) {
      continue;
    }

    const span = file.content === null
      ? { start: d.startLine, end: d.endLine }
      : locate(file.content, d.quote, d.startLine);
    if (!span) {
      continue;
    }

    if (seen.has(dedupeKey(id, d.quote))) {
      continue;
    }

    result.push({
      reviewId: file.row.reviewId,
      fileId: file.row.id,
      unitId: ctx.unit.id,
      path: file.row.path,
      startLine: span.start,
      endLine: span.end,
      quote: d.quote,
      ruleId: id,
      categoryId: match.category.id,
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

// The unit file a draft names: exact path, else a path ending with it
// ("pay.ts" for "src/pay.ts"), else the only file.
function draftFile(d: FindingDraft, files: LoadedFile[]): LoadedFile | undefined {
  const named = d.path?.trim().replace(/^\.?\//, "") ?? "";
  const exact = files.find((f) => f.row.path === named);
  if (exact) {
    return exact;
  }

  const suffix = named && files.find((f) => f.row.path.endsWith(`/${named}`));
  if (suffix) {
    return suffix;
  }

  return files.length === 1 ? files[0] : undefined;
}

function dedupeKey(ruleId: number, quote: string): string {
  return `${ruleId}|${quote.replace(/\s+/g, " ").trim()}`;
}

// Marks fully reviewed files and drops duplicate findings: same rule on
// overlapping lines (chunks and passes can repeat each other).
function finishFiles(reviewId: number, fileIds: Set<number>): void {
  const units = unitsForReview(reviewId);

  for (const fileId of fileIds) {
    const fileUnits = units.filter((u) => unitFileIds(u).includes(fileId));
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

// Rewrites the review summary, e.g. after findings were dismissed or fixed.
export async function summarizeReview(reviewId: number): Promise<void> {
  const review = requireIdle(reviewId);
  const project = projectById(review.projectId);
  if (!project) {
    throw new InputError("Unknown project");
  }

  const model = resolveModel(review.modelId);
  const ctx: RunContext = { review, project, snapshot: JSON.parse(review.rules), model, signal: new AbortController().signal };
  await modelLimiter(model.model.id, model.model.maxConcurrency)(() => conclude(ctx));
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

  if (review.mode === DiffMode.Pasted) {
    throw new InputError("Pasted code isn't in the project: nothing to refresh");
  }

  const source = { mode: review.mode, base: review.base, head: review.head, paths: reviewPaths(review) };
  const resolved = await resolveSource(project.path, source);
  const parsed = await loadChanges(project.path, source, resolved);
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

function reviewPaths(review: Review): string[] | null {
  return review.paths ? z.array(z.string()).parse(JSON.parse(review.paths)) : null;
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

  // Planned again on launch, with a fresh overview.
  updateReview(reviewId, { summary: "", conclusion: "" });
  appendReviewTrace(reviewId, `Re-review of ${changed.length} changed ${changed.length === 1 ? "file" : "files"}`);
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
