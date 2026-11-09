import { desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { projectNotes, type ProjectNote } from "./schema";

// A project's memory notes, most recently updated first.
export function notesForProject(projectId: number): ProjectNote[] {
  return getDb()
    .select()
    .from(projectNotes)
    .where(eq(projectNotes.projectId, projectId))
    .orderBy(desc(projectNotes.updatedAt), desc(projectNotes.id))
    .all();
}

export function noteById(id: number): ProjectNote | undefined {
  return getDb().select().from(projectNotes).where(eq(projectNotes.id, id)).get();
}

export function insertNote(projectId: number, title: string, body: string): ProjectNote {
  return getDb().insert(projectNotes).values({ projectId, title, body }).returning().get();
}

export function updateNote(id: number, title: string, body: string): void {
  getDb().update(projectNotes).set({ title, body, updatedAt: new Date() }).where(eq(projectNotes.id, id)).run();
}

export function deleteNote(id: number): void {
  getDb().delete(projectNotes).where(eq(projectNotes.id, id)).run();
}
