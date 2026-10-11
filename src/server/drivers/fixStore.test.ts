import fs from "node:fs";
import Database from "better-sqlite3";
import { expect, it } from "vitest";

it("repairs persisted Git path terminators without trimming spaces", () => {
  const db = new Database(":memory:");
  // Minimal legacy tables isolate the migration from current write code.
  db.exec(`
    CREATE TABLE findings (id INTEGER PRIMARY KEY, path TEXT);
    CREATE TABLE review_files (path TEXT, old_path TEXT);
  `);
  db.prepare("INSERT INTO findings VALUES (?, ?)").run(1, "my file.py\t");
  db.prepare("INSERT INTO review_files VALUES (?, ?)").run("my file.py\t", "old file.py\t");
  db.exec(fs.readFileSync("drizzle/0006_fix_undo.sql", "utf8"));
  expect(db.prepare("SELECT path FROM findings").get()).toEqual({ path: "my file.py" });
  expect(db.prepare("SELECT * FROM review_files").get()).toEqual({ path: "my file.py", old_path: "old file.py" });
  db.close();
});
