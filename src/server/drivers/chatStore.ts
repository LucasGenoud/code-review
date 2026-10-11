import { asc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { chatMessages } from "./schema";

// Messages are stored as opaque JSON; the chat service owns their shape.
export function loadMessages(reviewId: number): unknown[] {
  return getDb()
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.reviewId, reviewId))
    .orderBy(asc(chatMessages.position))
    .all()
    .map((row) => JSON.parse(row.message));
}

// Replaces the whole thread: the client always sends the full history.
export function saveMessages(reviewId: number, messages: { id: string }[]): void {
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(chatMessages).where(eq(chatMessages.reviewId, reviewId)).run();
    if (messages.length === 0) {
      return;
    }

    tx.insert(chatMessages)
      .values(
        messages.map((m, position) => ({
          id: `${reviewId}:${m.id}`,
          reviewId,
          position,
          message: JSON.stringify(m),
        })),
      )
      .run();
  });
}
