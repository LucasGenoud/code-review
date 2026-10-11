import fs from "node:fs";
import Database from "better-sqlite3";
import { expect, it } from "vitest";

it("preserves legacy rules, overrides, proposals and frozen snapshots", () => {
  const db = new Database(":memory:");
  // Model the old columns to isolate the upgrade from application writes.
  db.exec(`
    CREATE TABLE rules (id INTEGER, text TEXT);
    CREATE TABLE rule_overrides (text TEXT);
    CREATE TABLE rule_changes (text TEXT);
    CREATE TABLE reviews (rules TEXT);
    INSERT INTO rules VALUES (1, 'Current instructions');
    INSERT INTO rule_overrides VALUES ('Project instructions');
    INSERT INTO rule_changes VALUES ('Suggested instructions');
  `);
  const snapshot = { categories: [{ id: 1, rules: [{ id: 1, text: "Historical instructions", severity: "minor" }] }, { id: 2, rules: [] }] };
  db.prepare("INSERT INTO reviews VALUES (?)").run(JSON.stringify(snapshot));

  db.exec(fs.readFileSync("drizzle/0005_rule_names.sql", "utf8"));
  expect(db.prepare("SELECT name, text FROM rules").get()).toEqual({ name: "Current instructions", text: "Current instructions" });
  expect(db.prepare("SELECT name, text FROM rule_overrides").get()).toEqual({ name: null, text: "Project instructions" });
  expect(db.prepare("SELECT name FROM rule_changes").get()).toEqual({ name: "Suggested instructions" });
  const saved = db.prepare("SELECT rules FROM reviews").get() as { rules: string };
  expect(JSON.parse(saved.rules)).toEqual({ categories: [
    { id: 1, rules: [{ id: 1, name: "Historical instructions", description: "Historical instructions", severity: "minor" }] },
    { id: 2, rules: [] },
  ] });
  db.close();
});
