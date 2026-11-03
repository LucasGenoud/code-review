import { CategoryKind, FileChange, FindingStatus, SEVERITY_RANK, Severity, UnitStatus } from "@/lib/domain";
import type { Finding, Report, ReviewFile, UnitView } from "@/app/reviews/actions";

// Pure helpers for the report page: filtering, sorting, diff parsing.

export type Category = Report["rules"]["categories"][number];

export const ALL = "all";

export type StatusFilter = FindingStatus | typeof ALL;

export type Filters = {
  // Empty = every category / severity.
  categories: number[];
  severities: Severity[];
  status: StatusFilter;
  bugsOnly: boolean;
};

export const DEFAULT_FILTERS: Filters = {
  categories: [],
  severities: [],
  status: FindingStatus.Open,
  bugsOnly: false,
};

// Highest first, e.g. critical, major, minor, info.
export const SEVERITIES = Object.values(Severity).sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a]);

// Category, severity and "bugs only" filters. Status is separate: the diff
// shows closed findings collapsed, the panel hides them.
export function matchesScope(f: Finding, filters: Filters, categories: Map<number, Category>): boolean {
  if (filters.categories.length > 0 && !filters.categories.includes(f.categoryId)) {
    return false;
  }

  if (filters.severities.length > 0 && !filters.severities.includes(f.severity)) {
    return false;
  }

  if (filters.bugsOnly && categories.get(f.categoryId)?.kind !== CategoryKind.Bugs) {
    return false;
  }

  return true;
}

export function matchesStatus(f: Finding, status: StatusFilter): boolean {
  return status === ALL || f.status === status;
}

// Bugs first, then severity, then path and line.
export function sortFindings(findings: Finding[], categories: Map<number, Category>): Finding[] {
  const bugRank = (f: Finding) => (categories.get(f.categoryId)?.kind === CategoryKind.Bugs ? 0 : 1);

  return [...findings].sort(
    (a, b) =>
      bugRank(a) - bugRank(b) ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.path.localeCompare(b.path) ||
      a.endLine - b.endLine,
  );
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;

// New-file line ranges shown by a unified patch.
// e.g. "@@ -1,4 +1,6 @@" → [[1, 6]].
export function newLineRanges(patch: string): [number, number][] {
  return [...patch.matchAll(HUNK_HEADER)].map((m) => {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    return [start, start + count - 1];
  });
}

// Whether a finding can be anchored inline under a line of the diff.
export function isInDiff(f: Finding, file: ReviewFile, ranges: [number, number][]): boolean {
  if (file.change === FileChange.Deleted) {
    return false;
  }

  return ranges.some(([start, end]) => f.endLine >= start && f.endLine <= end);
}

// Added / removed line counts, e.g. { added: 12, removed: 3 }.
export function lineStats(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;

  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }

    if (line.startsWith("+")) {
      added++;
    } else if (line.startsWith("-")) {
      removed++;
    }
  }

  return { added, removed };
}

// "shop/users.py" → { dir: "shop/", name: "users.py" }.
export function splitPath(path: string): { dir: string; name: string } {
  const cut = path.lastIndexOf("/") + 1;
  return { dir: path.slice(0, cut), name: path.slice(cut) };
}

export function isFinished(u: UnitView): boolean {
  return u.status === UnitStatus.Done || u.status === UnitStatus.Failed;
}

// Units that review a file, alone or in a group.
export function unitsOfFile(units: UnitView[], fileId: number): UnitView[] {
  return units.filter((u) => u.fileIds.includes(fileId));
}

// Where a file stands in a running review, from its units.
export enum FileProgress {
  Reviewing = "reviewing",
  Queued = "queued",
  Done = "done",
}

export function fileProgress(units: UnitView[]): FileProgress | null {
  if (units.length === 0) {
    return null;
  }

  if (units.some((u) => u.status === UnitStatus.Running)) {
    return FileProgress.Reviewing;
  }

  return units.some((u) => u.status === UnitStatus.Pending) ? FileProgress.Queued : FileProgress.Done;
}

// "Refund flow", else the files' names: "pay.ts", "pay.ts + 2 files".
export function unitName(u: UnitView, paths: Map<number, string>): string {
  if (u.title) {
    return u.title;
  }

  const first = splitPath(paths.get(u.fileIds[0]) ?? "?").name;
  const more = u.fileIds.length - 1;
  const part = u.chunk > 0 ? ` (part ${u.chunk + 1})` : "";
  return more > 0 ? `${first} + ${more} ${more === 1 ? "file" : "files"}` : `${first}${part}`;
}

// DOM ids used to scroll to a file or an inline finding.
export function fileAnchor(fileId: number): string {
  return `file-${fileId}`;
}

export function findingAnchor(findingId: number): string {
  return `finding-${findingId}`;
}

// Finding row in the findings panel.
export function listAnchor(findingId: number): string {
  return `finding-item-${findingId}`;
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

// 4849 → "4.8K".
export function formatTokens(n: number): string {
  return compact.format(n);
}
