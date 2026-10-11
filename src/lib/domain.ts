// Domain enums shared by server and UI. No server imports here: client-safe.

export enum ProviderKind {
  OpenAI = "openai",
  Anthropic = "anthropic",
  Compatible = "openai_compatible",
}

export enum Severity {
  Info = "info",
  Minor = "minor",
  Major = "major",
  Critical = "critical",
}

// Ranking for sorting, highest first. e.g. critical (3) before info (0).
export const SEVERITY_RANK: Record<Severity, number> = {
  [Severity.Info]: 0,
  [Severity.Minor]: 1,
  [Severity.Major]: 2,
  [Severity.Critical]: 3,
};

export enum CategoryKind {
  Custom = "custom",
  // Built-in, can't be deleted, always reviewed in its own pass.
  Bugs = "bugs",
  // Built-in rule pack for one language, scoped by file globs. Can't be deleted.
  Language = "language",
}

// Built-in categories are disabled, never deleted.
export function isBuiltIn(kind: CategoryKind): boolean {
  return kind !== CategoryKind.Custom;
}

export enum DiffMode {
  Uncommitted = "uncommitted",
  LastCommit = "last_commit",
  Commits = "commits",
  Branches = "branches",
}

export enum ReviewStatus {
  Running = "running",
  Done = "done",
  Failed = "failed",
  Canceled = "canceled",
}

export enum UnitStatus {
  Pending = "pending",
  Running = "running",
  Done = "done",
  Failed = "failed",
}

export enum FileChange {
  Added = "added",
  Modified = "modified",
  Deleted = "deleted",
  Renamed = "renamed",
}

// Review state of one file in a review.
export enum FileState {
  Queued = "queued",
  Reviewed = "reviewed",
  Skipped = "skipped",
  // Diff changed since last review (after refresh). Needs re-review.
  Changed = "changed",
}

export enum FindingStatus {
  Open = "open",
  Dismissed = "dismissed",
  Fixed = "fixed",
  // Quoted code no longer exists in the file.
  Outdated = "outdated",
}

export enum Confidence {
  Likely = "likely",
  Possible = "possible",
}

export enum ChangeKind {
  Add = "add",
  Edit = "edit",
  Disable = "disable",
  Severity = "severity",
}

export enum ChangeStatus {
  Pending = "pending",
  Accepted = "accepted",
  Rejected = "rejected",
}

// Owner of a category or rule: every project, or one project only.
export enum Scope {
  Global = "global",
  Project = "project",
}

// Where an accepted rule change lands.
export enum ChangeScope {
  Project = "project",
  Global = "global",
}

// Category colors. Stored by name; UI maps them to classes.
export const CATEGORY_COLORS = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
  "slate",
] as const;

export type CategoryColor = (typeof CATEGORY_COLORS)[number];

// Stable key the LLM cites for a rule. e.g. rule id 12 → "R12".
export function ruleKey(ruleId: number): string {
  return `R${ruleId}`;
}
