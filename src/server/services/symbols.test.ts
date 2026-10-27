import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { grepAt } from "@/server/drivers/git";
import { definitionPattern, outline } from "./symbols";

const TS = `import { db } from "./db";

export async function loadOrder(id: number) {
  return db.find(id);
}

export const saveOrder = async (order: Order) => {
  if (order.total > 0) {
    await loadOrder(order.id);
  }
};

export class Cart {
  total(items: Item[]): number {
    return items.length;
  }
}
`;

const PY = `class Cart:
    def total(self, items):
        return len(items)

def load_order(order_id):
    return Cart().total([])
`;

const GO = `package shop

func (c *Cart) Total() int {
	return LoadOrder(1)
}
`;

let repo: string;

// Same isolation as the git driver tests: no host git config.
beforeAll(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prr-symbols-"));
  const empty = path.join(tmp, "empty.gitconfig");
  fs.writeFileSync(empty, "");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.GIT_CONFIG_GLOBAL = empty;

  repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "order.ts"), TS);
  fs.writeFileSync(path.join(repo, "cart.py"), PY);
  fs.writeFileSync(path.join(repo, "cart.go"), GO);
});

async function definitions(name: string): Promise<string[]> {
  const out = await grepAt(repo, definitionPattern(name), null);
  return out.split("\n").filter(Boolean).sort();
}

describe("definitionPattern", () => {
  it("finds declarations, not calls", async () => {
    expect(await definitions("loadOrder")).toEqual(["order.ts:3:export async function loadOrder(id: number) {"]);
    expect(await definitions("saveOrder")).toEqual(["order.ts:7:export const saveOrder = async (order: Order) => {"]);
  });

  it("finds methods and classes across languages", async () => {
    expect(await definitions("total")).toEqual([
      "cart.py:2:    def total(self, items):",
      "order.ts:14:  total(items: Item[]): number {",
    ]);
    expect(await definitions("Total")).toEqual(["cart.go:3:func (c *Cart) Total() int {"]);
    expect(await definitions("Cart")).toEqual(["cart.py:1:class Cart:", "order.ts:13:export class Cart {"]);
  });
});

describe("outline", () => {
  it("lists declarations with line numbers", () => {
    expect(outline(TS)).toEqual([
      "3: export async function loadOrder(id: number) {",
      "7: export const saveOrder = async (order: Order) => {",
      "13: export class Cart {",
      "14: total(items: Item[]): number {",
    ]);
    expect(outline(PY)).toEqual(["1: class Cart:", "2: def total(self, items):", "5: def load_order(order_id):"]);
  });
});
