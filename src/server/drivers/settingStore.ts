import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { settings } from "./schema";

export function readSetting(key: string): string | undefined {
  return getDb().select().from(settings).where(eq(settings.key, key)).get()?.value;
}

export function writeSetting(key: string, value: string): void {
  getDb()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}
