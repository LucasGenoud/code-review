// Scores review findings against the bench's answer key (see build.mjs).
//
// A finding matches an issue when it sits in the same file, within LINE_SLACK
// lines of one of the issue's locations. Closest pairs match first, one
// finding per issue. Further findings near a matched issue are duplicates;
// findings near no issue are unmatched: false positives, or real issues the
// key lacks. Read unmatched findings before trusting precision.

export enum IssueKind {
  Bug = "bug",
  Rule = "rule",
}

export enum Difficulty {
  Easy = "easy",
  Medium = "medium",
  Hard = "hard",
}

export type Location = { path: string; start: number; end: number };

export type Issue = {
  id: string;
  kind: IssueKind;
  difficulty: Difficulty;
  // Spotting it takes code outside the diff, e.g. an unchanged caller.
  outsideDiff?: boolean;
  note: string;
  locations: Location[];
};

export type BenchCase = { name: string; base: string; head: string; title: string; issues: Issue[] };

export type Spot = { path: string; startLine: number; endLine: number };

// hits: issue id → index of its finding.
export type CaseMatch = { hits: Map<string, number>; duplicates: number[]; unmatched: number[] };

export type Tally = { hit: number; total: number };

export type Summary = {
  issues: Tally;
  groups: Record<string, Tally>;
  findings: number;
  duplicates: number;
  unmatched: number;
  // Findings on cases without planted issues: all false positives or misses in the key.
  cleanFindings: number;
};

// Models often point at the line above, the call site or the closing brace.
const LINE_SLACK = 3;

function distance(f: Spot, loc: Location): number {
  if (f.path !== loc.path) {
    return Infinity;
  }

  return Math.max(0, f.startLine - loc.end, loc.start - f.endLine);
}

export function matchFindings(issues: Issue[], findings: Spot[]): CaseMatch {
  const pairs: { id: string; finding: number; d: number }[] = [];
  for (const issue of issues) {
    findings.forEach((f, i) => {
      const d = Math.min(...issue.locations.map((loc) => distance(f, loc)));
      if (d <= LINE_SLACK) {
        pairs.push({ id: issue.id, finding: i, d });
      }
    });
  }

  // Closest first, so adjacent issues each keep their own finding.
  pairs.sort((a, b) => a.d - b.d);
  const hits = new Map<string, number>();
  const used = new Set<number>();
  for (const p of pairs) {
    if (hits.has(p.id) || used.has(p.finding)) {
      continue;
    }

    hits.set(p.id, p.finding);
    used.add(p.finding);
  }

  const near = new Set(pairs.map((p) => p.finding));
  const indexes = findings.map((_, i) => i);
  return {
    hits,
    duplicates: indexes.filter((i) => near.has(i) && !used.has(i)),
    unmatched: indexes.filter((i) => !near.has(i)),
  };
}

// Recall overall and per group (kind, difficulty, outside-diff), plus noise.
export function summarize(scored: { issues: Issue[]; match: CaseMatch; findings: number }[]): Summary {
  const summary: Summary = {
    issues: { hit: 0, total: 0 },
    groups: {},
    findings: 0,
    duplicates: 0,
    unmatched: 0,
    cleanFindings: 0,
  };

  for (const { issues, match, findings } of scored) {
    summary.findings += findings;
    summary.duplicates += match.duplicates.length;
    summary.unmatched += match.unmatched.length;
    if (issues.length === 0) {
      summary.cleanFindings += findings;
    }

    for (const issue of issues) {
      const hit = match.hits.has(issue.id) ? 1 : 0;
      const groups = [`kind:${issue.kind}`, `difficulty:${issue.difficulty}`];
      if (issue.outsideDiff) {
        groups.push("outside-diff");
      }

      for (const t of [summary.issues, ...groups.map((g) => (summary.groups[g] ??= { hit: 0, total: 0 }))]) {
        t.hit += hit;
        t.total++;
      }
    }
  }

  return summary;
}
