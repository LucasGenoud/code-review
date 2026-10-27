import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { chatMessages, chatThreads, type ChatThreadRow } from "./schema";

// A review's chat, or one codebase Q&A conversation.
export type ChatThread = { reviewId: number } | { threadId: number };

function threadFilter(thread: ChatThread) {
  return "reviewId" in thread ? eq(chatMessages.reviewId, thread.reviewId) : eq(chatMessages.threadId, thread.threadId);
}

// Row id prefix, unique across threads, e.g. "12:" (review) or "t3:" (codebase thread).
function idPrefix(thread: ChatThread): string {
  return "reviewId" in thread ? `${thread.reviewId}:` : `t${thread.threadId}:`;
}

// Messages are stored as opaque JSON; the chat service owns their shape.
export function loadMessages(thread: ChatThread): unknown[] {
  return getDb()
    .select()
    .from(chatMessages)
    .where(threadFilter(thread))
    .orderBy(asc(chatMessages.position))
    .all()
    .map((row) => JSON.parse(row.message));
}

// Makes the stored thread match `messages`: the client always sends the
// full history, but only new, changed or removed messages are written.
export function saveMessages(thread: ChatThread, messages: { id: string }[]): void {
  const db = getDb();
  db.transaction((tx) => {
    const stored = new Map(
      tx
        .select({ id: chatMessages.id, position: chatMessages.position, message: chatMessages.message })
        .from(chatMessages)
        .where(threadFilter(thread))
        .all()
        .map((row) => [row.id, row]),
    );
    const rows = messages.map((m, position) => ({
      id: `${idPrefix(thread)}${m.id}`,
      ...thread,
      position,
      message: JSON.stringify(m),
    }));

    const kept = new Set(rows.map((r) => r.id));
    const removed = [...stored.keys()].filter((id) => !kept.has(id));
    if (removed.length > 0) {
      tx.delete(chatMessages).where(inArray(chatMessages.id, removed)).run();
    }

    for (const row of rows) {
      const old = stored.get(row.id);
      if (old?.position === row.position && old.message === row.message) {
        continue;
      }

      tx.insert(chatMessages)
        .values(row)
        .onConflictDoUpdate({ target: chatMessages.id, set: { position: row.position, message: row.message } })
        .run();
    }
  });
}

// Codebase threads, most recently active first.
export function threadsForProject(projectId: number): ChatThreadRow[] {
  return getDb()
    .select()
    .from(chatThreads)
    .where(eq(chatThreads.projectId, projectId))
    .orderBy(desc(chatThreads.updatedAt), desc(chatThreads.id))
    .all();
}

export function threadById(id: number): ChatThreadRow | undefined {
  return getDb().select().from(chatThreads).where(eq(chatThreads.id, id)).get();
}

export function insertThread(projectId: number, title: string): ChatThreadRow {
  return getDb().insert(chatThreads).values({ projectId, title }).returning().get();
}

// Marks the thread active now, moving it to the top of the history.
export function touchThread(id: number): void {
  getDb().update(chatThreads).set({ updatedAt: new Date() }).where(eq(chatThreads.id, id)).run();
}

export function renameThread(id: number, title: string): void {
  getDb().update(chatThreads).set({ title }).where(eq(chatThreads.id, id)).run();
}

export function deleteThread(id: number): void {
  getDb().delete(chatThreads).where(eq(chatThreads.id, id)).run();
}
