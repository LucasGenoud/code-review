import { asc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { chatMessages } from "./schema";

// A review's chat, or a project's codebase Q&A.
export type ChatThread = { reviewId: number } | { projectId: number };

function threadFilter(thread: ChatThread) {
  return "reviewId" in thread ? eq(chatMessages.reviewId, thread.reviewId) : eq(chatMessages.projectId, thread.projectId);
}

// Row id prefix, unique across threads, e.g. "12:" (review) or "p3:" (project).
function idPrefix(thread: ChatThread): string {
  return "reviewId" in thread ? `${thread.reviewId}:` : `p${thread.projectId}:`;
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
