import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import { DiffMode, FileChange, FileState, ReviewStatus, UnitStatus } from "@/lib/domain";
import type * as Store from "./reviewStore";

// Above SQLite's 32766 bound variables once multiplied by the columns.
const MANY = 5000;
let store: typeof Store;

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "prr-store-"));
  store = await import("./reviewStore");
});

it("inserts thousands of files and units", async () => {
  const { insertProject } = await import("./projectStore");
  const project = insertProject("Big", "/big");
  const review = store.insertReview({
    projectId: project.id, mode: DiffMode.Uncommitted, base: null, head: null, baseSha: "x", headSha: null,
    modelLabel: "Test", status: ReviewStatus.Running, rules: '{"categories":[]}',
  });

  const files = store.insertFiles(Array.from({ length: MANY }, (_, i) => ({
    reviewId: review.id, path: `f${i}.ts`, change: FileChange.Added, patch: "", hash: "h", state: FileState.Queued,
  })));
  const units = store.insertUnits(files.map((f) => ({
    reviewId: review.id, fileId: f.id, pass: "bugs", categoryIds: "[]", hunks: "[0]", status: UnitStatus.Pending,
  })));

  expect(units).toHaveLength(MANY);
  expect(units[MANY - 1].fileId).toBe(files[MANY - 1].id);
});
