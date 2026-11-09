import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import type * as Notes from "./notes";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prr-notes-"));
let notes: typeof Notes;
let projectId: number;

beforeAll(async () => {
  process.env.DATA_DIR = path.join(tmp, "data");
  process.env.REPO_ROOT = tmp;
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });

  const projects = await import("./projects");
  notes = await import("./notes");
  projectId = (await projects.addProject(repo)).id;
});

it("gives whole notes newest first within the budget, then titles", () => {
  const old = notes.saveNote(projectId, { title: "Auth flow", body: "Login lives in src/auth.ts:10." });
  const recent = notes.saveNote(projectId, { title: "Payments", body: "x".repeat(200) });

  const all = notes.memoryContext(projectId, 1_000);
  expect(all.omitted).toBe(false);
  expect(all.text.indexOf("Payments")).toBeLessThan(all.text.indexOf("Auth flow"));

  const tight = notes.memoryContext(projectId, 250);
  expect(tight.omitted).toBe(true);
  expect(tight.text).toContain(`### #${recent.id} Payments`);
  expect(tight.text).toContain(`Other notes (read_note to open): #${old.id} Auth flow`);
});

it("reads a listed note, and only the project's", async () => {
  const [note] = notes.listNotes(projectId);
  const read = notes.noteTools(projectId).read_note;

  expect(await read.run({ id: note.id })).toContain(note.title);
  expect(await notes.noteTools(projectId + 1).read_note.run({ id: note.id })).toBe(`Error: no note #${note.id}.`);
  expect(() => notes.removeNote(projectId + 1, note.id)).toThrow("Unknown note");
});

it("rejects empty notes", () => {
  expect(() => notes.saveNote(projectId, { title: " ", body: "text" })).toThrow();
});
