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

export function reopenFinding(id: number): void {
  requireFinding(id);
  updateFinding(id, { status: FindingStatus.Open, dismissReason: null });
}

// Writes the suggested fix into the working tree. Refuses when the quoted
// code changed since the review, so nothing is overwritten blindly.
export async function applyFix(id: number): Promise<void> {
  const finding = requireFinding(id);
  if (!finding.replacement) {
    throw new InputError("This finding has no suggested fix");
  }

  const review = requireReview(finding.reviewId);
  const project = projectById(review.projectId);
  if (!project) {
    throw new InputError("Unknown project");
  }

  // finding.path comes from git, but stays confined to the project anyway.
  const file = path.resolve(project.path, finding.path);
  if (!isInside(project.path, file)) {
    throw new InputError("File is outside the project");
  }

  const bytes = await readBytes(file);
  if (!bytes) {
    throw new InputError("File not found in the working tree");
  }

  const updated = replaceQuote(bytes.toString("utf8"), finding.quote, finding.replacement);
  if (updated === null) {
    throw new InputError("The quoted code changed or appears more than once. Refresh the review.");
  }

  await writeText(file, updated);
  updateFinding(id, { status: FindingStatus.Fixed });

  // Lines of other findings in the file may have shifted.
  for (const f of findingsForFile(finding.fileId)) {
    if (f.status !== FindingStatus.Open) {
      continue;
    }

    const span = locate(updated, f.quote, f.startLine);
    updateFinding(f.id, span ? { startLine: span.start, endLine: span.end } : { status: FindingStatus.Outdated });
  }
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
