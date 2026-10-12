import { describe, expect, it } from "vitest";
import { Difficulty, type Issue, IssueKind, matchFindings, summarize } from "./score";

function issue(id: string, path: string, start: number, end = start): Issue {
  return { id, kind: IssueKind.Bug, difficulty: Difficulty.Medium, note: "", locations: [{ path, start, end }] };
}

const at = (path: string, startLine: number, endLine = startLine) => ({ path, startLine, endLine });

describe("matchFindings", () => {
  it("matches within the line slack, not beyond", () => {
    const issues = [issue("a", "A.java", 10)];
    expect(matchFindings(issues, [at("A.java", 13)]).hits.get("a")).toBe(0);
    expect(matchFindings(issues, [at("A.java", 14)]).unmatched).toEqual([0]);
  });

  it("counts ranges as overlapping", () => {
    const issues = [issue("a", "A.java", 20, 24)];
    expect(matchFindings(issues, [at("A.java", 10, 22)]).hits.get("a")).toBe(0);
  });

  it("ignores other files", () => {
    expect(matchFindings([issue("a", "A.java", 10)], [at("B.java", 10)]).unmatched).toEqual([0]);
  });

  it("gives adjacent issues their own closest finding", () => {
    const issues = [issue("a", "A.java", 10), issue("b", "A.java", 12)];
    const match = matchFindings(issues, [at("A.java", 12), at("A.java", 10)]);
    expect(match.hits).toEqual(new Map([["a", 1], ["b", 0]]));
  });

  it("counts a second finding on one issue as duplicate", () => {
    const match = matchFindings([issue("a", "A.java", 10)], [at("A.java", 10), at("A.java", 11)]);
    expect(match.hits.get("a")).toBe(0);
    expect(match.duplicates).toEqual([1]);
    expect(match.unmatched).toEqual([]);
  });

  it("matches any location of a multi-file issue", () => {
    const multi: Issue = { ...issue("a", "A.java", 10), locations: [{ path: "A.java", start: 10, end: 10 }, { path: "B.java", start: 5, end: 5 }] };
    expect(matchFindings([multi], [at("B.java", 6)]).hits.get("a")).toBe(0);
  });
});

describe("summarize", () => {
  it("tallies recall per group and findings on clean cases", () => {
    const hard: Issue = { ...issue("h", "A.java", 1), difficulty: Difficulty.Hard, outsideDiff: true };
    const s = summarize([
      { issues: [issue("a", "A.java", 10), hard], match: matchFindings([issue("a", "A.java", 10), hard], [at("A.java", 10)]), findings: 1 },
      { issues: [], match: matchFindings([], [at("C.java", 1)]), findings: 1 },
    ]);

    expect(s.issues).toEqual({ hit: 1, total: 2 });
    expect(s.groups["difficulty:hard"]).toEqual({ hit: 0, total: 1 });
    expect(s.groups["outside-diff"]).toEqual({ hit: 0, total: 1 });
    expect(s.cleanFindings).toBe(1);
    expect(s.unmatched).toBe(1);
  });
});
