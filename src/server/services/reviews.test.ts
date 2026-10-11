import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import { DiffMode, FileChange, FileState, FindingStatus, ReviewStatus, Severity } from "@/lib/domain";
import type * as Reviews from "./reviews";
import type * as Store from "@/server/drivers/reviewStore";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prr-fixes-"));
const ORIGINAL = "before\r\n  bad()\r\nafter\r\n";
let reviews: typeof Reviews;
let store: typeof Store;
let nextRepo = 0;

// Exercise real git, files and migrated storage without an LLM.
beforeAll(async () => {
  process.env.DATA_DIR = path.join(tmp, "data");
  reviews = await import("./reviews");
  store = await import("@/server/drivers/reviewStore");
});

function git(repo: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args], { cwd: repo, encoding: "utf8" }).trim();
}

async function fixture() {
  const repo = path.join(tmp, `repo-${nextRepo++}`);
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "base.py"), "base\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "Base");
  const baseSha = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-qb", "feature");
  const file = path.join(repo, "my file.py");
  fs.writeFileSync(file, ORIGINAL);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "Feature");
  const headSha = git(repo, "rev-parse", "HEAD");
  const { insertProject } = await import("@/server/drivers/projectStore");
  const project = insertProject("App", repo);
  const review = store.insertReview({
    projectId: project.id, mode: DiffMode.Branches, base: "main", head: "feature", baseSha, headSha,
    modelLabel: "Test", status: ReviewStatus.Done, rules: '{"categories":[]}',
  });
  const { loadDiff } = await import("./diff");
  const parsed = await loadDiff(repo, { baseSha, headSha });
  const [row] = store.insertFiles([{
    reviewId: review.id, path: parsed[0].path, change: FileChange.Added,
    patch: parsed[0].patch, hash: "test", state: FileState.Reviewed,
  }]);
  store.insertFindings([{
    reviewId: review.id, fileId: row.id, path: row.path, startLine: 2, endLine: 2,
    quote: "bad()", replacement: "good()\nextra()", ruleId: 1, categoryId: 1,
    severity: Severity.Minor, title: "Fix", explanation: "Test", status: FindingStatus.Open,
  }]);
  const finding = store.findingsForReview(review.id)[0];
  return { repo, file, review, finding, row };
}

it("applies fixes to git paths containing spaces", async () => {
  const { file, finding, row } = await fixture();
  expect(row.path).toBe("my file.py");
  await reviews.applyFix(finding.id);
  expect(fs.readFileSync(file, "utf8")).toBe("before\r\n  good()\r\n  extra()\r\nafter\r\n");
});

it("explains when the reviewed head is not checked out", async () => {
  const { repo, file, finding } = await fixture();
  git(repo, "checkout", "-q", "main");
  await expect(reviews.applyFix(finding.id)).rejects.toThrow(/Check out.*feature/);
  expect(fs.existsSync(file)).toBe(false);
  expect(store.findingById(finding.id)?.status).toBe(FindingStatus.Open);
});

it("undoes a fix and restores affected finding locations", async () => {
  const { file, finding, review, row } = await fixture();
  store.insertFindings([{
    reviewId: review.id, fileId: row.id, path: row.path, startLine: 3, endLine: 3,
    quote: "after", ruleId: 1, categoryId: 1, severity: Severity.Minor,
    title: "Other", explanation: "Test", status: FindingStatus.Open,
  }]);
  await reviews.applyFix(finding.id);
  expect(store.findingsForFile(row.id).find((f) => f.title === "Other")?.startLine).toBe(4);
  expect(reviews.getReport(review.id).undoableFixes).toContain(finding.id);
  await reviews.undoFix(finding.id);
  expect(fs.readFileSync(file, "utf8")).toBe(ORIGINAL);
  expect(store.findingById(finding.id)?.status).toBe(FindingStatus.Open);
  expect(store.findingsForFile(row.id).find((f) => f.title === "Other")?.startLine).toBe(3);
  expect(reviews.getReport(review.id).undoableFixes).not.toContain(finding.id);
});

it("refuses undo after later file edits", async () => {
  const { file, finding } = await fixture();
  await reviews.applyFix(finding.id);
  fs.appendFileSync(file, "user edit\r\n");
  const edited = fs.readFileSync(file, "utf8");
  await expect(reviews.undoFix(finding.id)).rejects.toThrow(/changed since/);
  expect(fs.readFileSync(file, "utf8")).toBe(edited);
  expect(store.findingById(finding.id)?.status).toBe(FindingStatus.Fixed);
});

it("supports deletion fixes and exact undo", async () => {
  const { file, finding } = await fixture();
  store.updateFinding(finding.id, { replacement: "" });
  await reviews.applyFix(finding.id);
  expect(fs.readFileSync(file, "utf8")).not.toContain("bad()");
  await reviews.undoFix(finding.id);
  expect(fs.readFileSync(file, "utf8")).toBe(ORIGINAL);
});

it("keeps undo when a fix removes the file from the diff", async () => {
  const { file, finding, review } = await fixture();
  git(path.dirname(file), "checkout", "-q", "main");
  // Review a working-tree edit that the fix restores to HEAD.
  fs.writeFileSync(file, "good()\n");
  git(path.dirname(file), "add", ".");
  git(path.dirname(file), "commit", "-qm", "Baseline");
  fs.writeFileSync(file, "bad()\n");
  store.updateReview(review.id, { mode: DiffMode.Uncommitted, headSha: null, base: null, head: null });
  store.updateFinding(finding.id, { replacement: "good()" });
  await reviews.applyFix(finding.id);
  const { refreshReview } = await import("./review/engine");
  await refreshReview(review.id);
  expect(reviews.getReport(review.id).undoableFixes).toContain(finding.id);
  await reviews.undoFix(finding.id);
  expect(fs.readFileSync(file, "utf8")).toBe("bad()\n");
});

it("undoes successive fixes in reverse order", async () => {
  const { file, finding, review, row } = await fixture();
  store.insertFindings([{
    reviewId: review.id, fileId: row.id, path: row.path, startLine: 3, endLine: 3,
    quote: "after", replacement: "end", ruleId: 1, categoryId: 1,
    severity: Severity.Minor, title: "Second", explanation: "Test", status: FindingStatus.Open,
  }]);
  const second = store.findingsForFile(row.id).find((f) => f.title === "Second")!;
  await Promise.all([reviews.applyFix(finding.id), reviews.applyFix(second.id)]);
  await expect(reviews.undoFix(finding.id)).rejects.toThrow(/changed since/);
  await reviews.undoFix(second.id);
  await reviews.undoFix(finding.id);
  expect(fs.readFileSync(file, "utf8")).toBe(ORIGINAL);
  expect(store.findingById(second.id)?.startLine).toBe(3);
});

it("refuses undo in another checkout even if the file matches", async () => {
  const { repo, file, finding } = await fixture();
  await reviews.applyFix(finding.id);
  const fixed = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, ORIGINAL);
  git(repo, "checkout", "-q", "main");
  fs.writeFileSync(file, fixed);
  await expect(reviews.undoFix(finding.id)).rejects.toThrow(/checked-out commit changed/);
  expect(fs.readFileSync(file, "utf8")).toBe(fixed);
});
