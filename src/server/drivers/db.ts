import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { config } from "@/server/config";
import * as schema from "./schema";

const DB_FILE = "app.db";
const MIGRATIONS_DIR = "drizzle";

type Db = BetterSQLite3Database<typeof schema>;

// Survives dev hot reloads, which would otherwise open a new connection per edit.
const cache = globalThis as unknown as { db?: Db };

// Opens the DB lazily (never at build time) and applies pending migrations.
export function getDb(): Db {
  if (cache.db) {
    return cache.db;
  }

  fs.mkdirSync(config.dataDir, { recursive: true });
  const sqlite = new Database(path.join(config.dataDir, DB_FILE));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(MIGRATIONS_DIR) });

  cache.db = db;
  return db;
}
