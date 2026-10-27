import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import type * as Store from "./chatStore";

let store: typeof Store;
let threadId: number;

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "prr-chat-"));
  store = await import("./chatStore");
  const { insertProject } = await import("./projectStore");
  threadId = store.insertThread(insertProject("Chat", "/chat").id, "Q").id;
});

function message(id: string, text: string) {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

// Rows inserted, updated or deleted since the connection opened.
async function rowsWritten(): Promise<number> {
  const { getDb } = await import("./db");
  return getDb().get<{ n: number }>(sql`select total_changes() as n`)!.n;
}

it("writes only new and changed messages, and drops removed ones", async () => {
  store.saveMessages({ threadId }, [message("a", "1"), message("b", "2"), message("c", "3")]);
  const before = await rowsWritten();

  store.saveMessages({ threadId }, [message("a", "1"), message("b", "2 edited"), message("d", "4")]);

  expect(store.loadMessages({ threadId })).toEqual([message("a", "1"), message("b", "2 edited"), message("d", "4")]);
  // b updated, d inserted, c deleted; a untouched.
  expect((await rowsWritten()) - before).toBe(3);
});
