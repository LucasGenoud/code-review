import { asc, desc, eq } from "drizzle-orm";
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

// Replaces the whole thread: the client always sends the full history.
export function saveMessages(thread: ChatThread, messages: { id: string }[]): void {
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(chatMessages).where(threadFilter(thread)).run();
    if (messages.length === 0) {
      return;
    }

    tx.insert(chatMessages)
      .values(
        messages.map((m, position) => ({
          id: `${idPrefix(thread)}${m.id}`,
          ...thread,
          position,
          message: JSON.stringify(m),
        })),
      )
      .run();
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
