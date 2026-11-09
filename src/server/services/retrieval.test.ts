import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import type { Project } from "@/server/drivers/schema";
import { repoTools, ToolScope, type RepoView } from "./repoTools";
import { locateCode, questionTerms, relevantCode } from "./retrieval";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prr-retrieval-"));
const BUDGET = 4_000;

const FILES: Record<string, string> = {
  "src/crypto.ts": `const ALGORITHM = "aes-256-gcm";

export function encrypt(plain: string): string {
  return seal(ALGORITHM, plain);
}

export function decrypt(sealed: string): string {
  return open(ALGORITHM, sealed);
}
`,
  "src/providers.ts": `import { encrypt } from "./crypto";

export function saveProvider(name: string, apiKey: string) {
  db.insert({ name, apiKey: encrypt(apiKey) });
}
`,
  "src/ui/button.tsx": `export function Button() {
  return <button>Save</button>;
}
`,
  "package-lock.json": `{ "encrypt": 1, "apiKey": 2, "encrypted": 3 }\n`.repeat(50),
  "README.md": "A project.\n",
};

let view: RepoView;

beforeAll(() => {
  const repo = path.join(tmp, "repo");
  for (const [name, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), text);
  }

  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  view = { project: { path: repo } as Project, review: null };
});

it("extracts code-like terms first, then stemmed words, without stopwords", () => {
  expect(questionTerms("Where are the `apiKey` values encrypted?")).toEqual(["apiKey", "encrypt", "value"]);
  expect(questionTerms("how does it work")).toEqual([]);
});

it("ranks files matching the question and leaves out lock files", async () => {
  const code = await relevantCode(view, "Where are API keys encrypted?", BUDGET);
  const files = [...code.matchAll(/^### (\S+)/gm)].map((m) => m[1]);

  // providers.ts holds every term; crypto.ts declares encrypt.
  expect(files).toEqual(["src/providers.ts", "src/crypto.ts"]);
  expect(code).not.toContain("package-lock.json");
  expect(code).toContain("3: export function encrypt(plain: string): string {");
  expect(code).toContain("4: db.insert({ name, apiKey: encrypt(apiKey) });");
});

it("puts a file the question names first", async () => {
  const code = await relevantCode(view, "What does button.tsx render?", BUDGET);

  expect(code).toMatch(/^Terms: [^\n]*\n\n### src\/ui\/button\.tsx/);
});

it("returns nothing when no term matches", async () => {
  expect(await relevantCode(view, "Explain the quantum flux capacitor", BUDGET)).toBe("");
});

it("locates terms within a glob", async () => {
  const code = await locateCode(view, ["encrypt"], "src/providers.ts", BUDGET);

  expect(code).toContain("### src/providers.ts");
  expect(code).not.toContain("src/crypto.ts");
});

it("reads several symbols in one call", async () => {
  const out = await repoTools(view, ToolScope.Chat).read_symbol.run({ names: ["encrypt", "decrypt"], path: null });

  expect(out).toContain("src/crypto.ts:3-5");
  expect(out).toContain("src/crypto.ts:7-9");
});
