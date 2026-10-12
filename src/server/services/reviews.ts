import path from "node:path";
import { z } from "zod";
import {
  DiffMode,
  FileState,
  FindingStatus,
  ReviewStatus,
  ruleKey,
  SEVERITY_RANK,
  UnitStatus,
} from "@/lib/domain";
import { fixByFinding, restoreFix, saveFix, undoableFixes, type FixState } from "@/server/drivers/fixStore";
import { resolveCommit } from "@/server/drivers/git";
import { readBytes, writeText } from "@/server/drivers/fs";
import { projectById } from "@/server/drivers/projectStore";
import {
  deleteReview,
  filesForReview,
  findingById,
  findingsForFile,
  findingsForReview,
  reviewById,
  reviewsForProject,
  unitById,
  unitsForReview,
  updateFinding,
} from "@/server/drivers/reviewStore";
import type { Finding, Review, ReviewFile } from "@/server/drivers/schema";
import { InputError } from "./errors";
import { isInside } from "./paths";
import { tokenCost } from "./providers";
import { isRunning } from "./review/engine";
import { locate, replaceQuote } from "./review/locate";
import type { RulesSnapshot } from "./rules";

export type { Finding, Review, ReviewFile, RulesSnapshot };

export type ReviewSummary = Review & {
  cost: number | null;
  findingCount: number;
  rangeLabel: string;
};

export type UnitView = {
  id: number;
  fileId: number;
  pass: string;
  chunk: number;
  status: UnitStatus;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
};

export type Report = {
  review: ReviewSummary;
  project: { id: number; name: string; path: string; description: string };
  rules: RulesSnapshot;
  files: ReviewFile[];
  findings: Finding[];
  units: UnitView[];
  running: boolean;
  undoableFixes: number[];
};

// "main...feature", "HEAD~1..HEAD", "working tree".
export function rangeLabel(r: Pick<Review, "mode" | "base" | "head">): string {
  const labels: Record<DiffMode, string> = {
    [DiffMode.Uncommitted]: "Uncommitted changes",
    [DiffMode.LastCommit]: "Last commit",
    [DiffMode.Commits]: `${r.base}..${r.head}`,
    [DiffMode.Branches]: `${r.base}...${r.head}`,
  };
  return labels[r.mode];
}

function summarize(r: Review, findingCount: number): ReviewSummary {
  return {
    ...r,
    cost: tokenCost(r.modelId, r.inputTokens, r.outputTokens),
    findingCount,
    rangeLabel: rangeLabel(r),
  };
}

export function listReviews(projectId: number): ReviewSummary[] {
  return reviewsForProject(projectId).map((r) => {
    const open = findingsForReview(r.id).filter((f) => f.status === FindingStatus.Open);
    return summarize(r, open.length);
  });
}

export function getReport(reviewId: number): Report {
  const review = requireReview(reviewId);
  const project = projectById(review.projectId);
  if (!project) {
    throw new InputError("Unknown project");
  }

  const findings = findingsForReview(reviewId);
  const open = findings.filter((f) => f.status === FindingStatus.Open);

  return {
    review: summarize(review, open.length),
    project: { id: project.id, name: project.name, path: project.path, description: project.description },
    rules: JSON.parse(review.rules),
    files: filesForReview(reviewId),
    findings,
    units: unitsForReview(reviewId).map((u) => ({
      id: u.id,
      fileId: u.fileId,
      pass: u.pass,
      chunk: u.chunk,
      status: u.status,
      error: u.error,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
    })),
    running: isRunning(reviewId),
    undoableFixes: undoableFixes(reviewId),
  };
}

// Exact prompt a unit sent, for the prompt preview.
export function unitPrompt(unitId: number): string {
  const unit = unitById(unitId);
  if (!unit) {
    throw new InputError("Unknown unit");
  }

  return unit.prompt ?? "(not sent yet)";
}

export function removeReview(reviewId: number): void {
  if (isRunning(reviewId)) {
    throw new InputError("Cancel the review first");
  }

  deleteReview(reviewId);
}

// --- findings --------------------------------------------------------------

export function dismissFinding(id: number, reason: string): void {
  requireFinding(id);
  const text = z.string().trim().max(2000).parse(reason);
  updateFinding(id, { status: FindingStatus.Dismissed, dismissReason: text || null });
}

// Fixed by hand, e.g. the user edited the code. No file write, no undo.
export function markFixed(id: number): void {
  requireFinding(id);
  updateFinding(id, { status: FindingStatus.Fixed, dismissReason: null });
}

export function reopenFinding(id: number): void {
  requireFinding(id);
  updateFinding(id, { status: FindingStatus.Open, dismissReason: null });
}

// Serialize writes within a project so simultaneous fixes cannot lose edits.
const fixLocks = new Map<number, Promise<void>>();
const COMMIT_LABEL_LENGTH = 7;

async function withFixLock(id: number, action: () => Promise<void>): Promise<void> {
  const finding = requireFinding(id);
  const projectId = requireReview(finding.reviewId).projectId;
  const previous = fixLocks.get(projectId) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(action);
  fixLocks.set(projectId, pending);
  try {
    await pending;
  } finally {
    if (fixLocks.get(projectId) === pending) {
      fixLocks.delete(projectId);
    }
  }
}

// Fixes always write to the checked-out tree, never a different branch.
export async function applyFix(id: number): Promise<void> {
  await withFixLock(id, () => applyFindingFix(id));
}

async function applyFindingFix(id: number): Promise<void> {
  const finding = requireFinding(id);
  if (finding.replacement === null) {
    throw new InputError("This finding has no suggested fix");
  }

  if (finding.status !== FindingStatus.Open || fixByFinding(id)) {
    throw new InputError("Only open findings can be fixed");
  }

  const { file, project, review } = fixTarget(finding);
  const headSha = await resolveCommit(project.path, "HEAD");
  if (review.headSha !== null && review.headSha !== headSha) {
    throw new InputError(`Check out the reviewed head "${review.head ?? review.headSha}" (${review.headSha.slice(0, COMMIT_LABEL_LENGTH)}) before applying fixes. Refresh the review if that branch has moved.`);
  }

  const bytes = await readBytes(file);
  if (!bytes) {
    throw new InputError(`File not found in the working tree: ${finding.path}. Restore the file or refresh the review.`);
  }

  const before = bytes.toString("utf8");
  const after = replaceQuote(before, finding.quote, finding.replacement);
  if (after === null) {
    throw new InputError("The quoted code changed or appears more than once. Refresh the review.");
  }

  // Snapshot affected positions before re-anchoring for an exact undo.
  const states = fixStates(finding, after);
  await writeText(file, after);
  try {
    saveFix({ findingId: id, before, after, headSha, findingStates: JSON.stringify(states) }, states);
  } catch (error) {
    await writeText(file, before);
    throw error;
  }
}

// Restore the saved version only while it is still the file's current content.
export async function undoFix(id: number): Promise<void> {
  await withFixLock(id, () => undoFindingFix(id));
}

async function undoFindingFix(id: number): Promise<void> {
  const finding = requireFinding(id);
  const fix = fixByFinding(id);
  if (!fix || finding.status !== FindingStatus.Fixed) {
    throw new InputError("This finding has no applied fix to undo");
  }

  const { file, project } = fixTarget(finding);
  if (await resolveCommit(project.path, "HEAD") !== fix.headSha) {
    throw new InputError("The checked-out commit changed since the fix. Check out the original commit before undoing it.");
  }

  const bytes = await readBytes(file);
  if (!bytes || bytes.toString("utf8") !== fix.after) {
    throw new InputError("The file changed since this fix. Undo later fixes or restore subsequent edits before undoing it.");
  }

  // Leave later dismissals and other finding decisions intact.
  const states = (JSON.parse(fix.findingStates) as FixState[]).filter((state) => {
    const current = findingById(state.id);
    return current?.status === state.after.status && current.startLine === state.after.startLine && current.endLine === state.after.endLine;
  });
  await writeText(file, fix.before);
  try {
    restoreFix(id, states);
  } catch (error) {
    await writeText(file, fix.after);
    throw error;
  }
}

// Resolve the shared target and keep git-provided paths inside the project.
function fixTarget(finding: Finding) {
  const review = requireReview(finding.reviewId);
  const project = projectById(review.projectId);
  if (!project) {
    throw new InputError("Unknown project");
  }

  const file = path.resolve(project.path, finding.path);
  if (!isInside(project.path, file)) {
    throw new InputError("File is outside the project");
  }

  return { file, project, review };
}

// Track only findings affected by the edit; unchanged ones need no inverse.
function fixStates(finding: Finding, content: string): FixState[] {
  const states: FixState[] = [];
  for (const other of findingsForFile(finding.fileId)) {
    if (other.id === finding.id || other.status !== FindingStatus.Open) {
      continue;
    }

    const span = locate(content, other.quote, other.startLine);
    const before = { status: other.status, startLine: other.startLine, endLine: other.endLine };
    const after = span
      ? { status: other.status, startLine: span.start, endLine: span.end }
      : { ...before, status: FindingStatus.Outdated };
    if (before.status !== after.status || before.startLine !== after.startLine || before.endLine !== after.endLine) {
      states.push({ id: other.id, before, after });
    }
  }

  return states;
}

function requireFinding(id: number): Finding {
  const f = findingById(id);
  if (!f) {
    throw new InputError("Unknown finding");
  }

  return f;
}

function requireReview(id: number): Review {
  const r = reviewById(id);
  if (!r) {
    throw new InputError("Unknown review");
  }

  return r;
}

// --- export ----------------------------------------------------------------

const STATUS_LABEL: Record<ReviewStatus, string> = {
  [ReviewStatus.Running]: "running",
  [ReviewStatus.Done]: "done",
  [ReviewStatus.Failed]: "incomplete",
  [ReviewStatus.Canceled]: "canceled",
};

// Report as Markdown, ready to paste into a PR. Open findings only.
export function exportMarkdown(reviewId: number): { filename: string; markdown: string } {
  const report = getReport(reviewId);
  const { review, rules } = report;
  const categories = new Map(rules.categories.map((c) => [c.id, c]));
  const open = report.findings
    .filter((f) => f.status === FindingStatus.Open)
    .sort((a, b) => a.path.localeCompare(b.path) || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const dismissed = report.findings.filter((f) => f.status === FindingStatus.Dismissed).length;
  const skipped = report.files.filter((f) => f.state === FileState.Skipped).length;

  const lines = [
    `# Code review: ${report.project.name}`,
    "",
    `- Range: ${review.rangeLabel}`,
    `- Model: ${review.modelLabel}`,
    `- Status: ${STATUS_LABEL[review.status]}`,
    `- Findings: ${open.length} open, ${dismissed} dismissed`,
    `- Files: ${report.files.length - skipped} reviewed, ${skipped} skipped`,
    "",
  ];

  if (review.summary) {
    lines.push("## Summary", "", review.summary, "");
  }

  let currentPath = "";
  for (const f of open) {
    if (f.path !== currentPath) {
      currentPath = f.path;
      lines.push(`## \`${f.path}\``, "");
    }

    const category = categories.get(f.categoryId)?.name ?? "Unknown";
    const range = f.startLine === f.endLine ? `L${f.startLine}` : `L${f.startLine}-${f.endLine}`;
    lines.push(`### ${f.title}`, "", `${range} · ${category} · ${f.severity} · ${ruleKey(f.ruleId)}`, "", f.explanation, "");

    if (f.failure) {
      lines.push(`**Failure:** ${f.failure}${f.confidence ? ` (${f.confidence})` : ""}`, "");
    }

    if (f.replacement) {
      lines.push("Suggested fix:", "", "```", f.replacement, "```", "");
    }
  }

  return { filename: `review-${reviewId}.md`, markdown: lines.join("\n") };
}
