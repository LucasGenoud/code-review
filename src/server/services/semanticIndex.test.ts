import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ProviderKind } from "@/lib/domain";
import { IndexPhase } from "@/lib/semantic";
import type * as Index from "./semanticIndex";

// Builds and searches a semantic index against a fake OpenAI-compatible
// /embeddings server whose vectors count words (camelCase split), so
// texts sharing words are close: enough to check the plumbing.

const DIMENSIONS = 64;
const POLL_MS = 50;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prr-semantic-"));
let server: http.Server;
let semantic: typeof Index;
let projectId: number;
let embedRequests = 0;
let lastInputs: string[] = [];

function fakeVector(text: string): number[] {
  const v = new Array<number>(DIMENSIONS).fill(0);
  const words = text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().match(/[a-z]{3,}/g) ?? [];
  for (const w of words) {
    let h = 0;
    for (const c of w) {
      h = (h * 31 + c.charCodeAt(0)) % DIMENSIONS;
    }
    v[h] += 1;
  }
  return v;
}

const FILES: Record<string, string> = {
  "src/payments/retry.ts": `export function retryDeclinedCard(payment: Payment) {
  // the card was declined: wait, then charge again
  return chargeAgain(payment, backoff(payment.attempts));
}
`,
  "src/ui/theme.ts": `export function pickTheme(dark: boolean) {
  return dark ? darkColors : lightColors;
}
`,
};

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const part of req) {
      body += part;
    }

    const { input } = JSON.parse(body) as { input: string[] };
    embedRequests++;
    lastInputs = input;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: fakeVector(t) })), usage: { prompt_tokens: input.length, total_tokens: input.length } }));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));

  const repo = path.join(tmp, "repo");
  for (const [name, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true });
    fs.writeFileSync(path.join(repo, name), text);
  }
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });

  process.env.DATA_DIR = path.join(tmp, "data");
  process.env.REPO_ROOT = tmp;
  const providers = await import("./providers");
  const projects = await import("./projects");
  semantic = await import("./semanticIndex");

  const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}/v1`;
  const providerId = providers.saveProvider({ name: "fake", kind: ProviderKind.Compatible, baseUrl, apiKey: "" });
  await providers.setEmbeddingModel({ providerId, model: "fake-embed", queryPrefix: "Query: " });
  projectId = (await projects.addProject(repo)).id;
});

afterAll(() => {
  server.close();
});

async function built() {
  while (semantic.semanticStatus(projectId).phase === IndexPhase.Building) {
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  return semantic.semanticStatus(projectId);
}

it("builds the index, then finds code by its words with the query prefix", async () => {
  semantic.buildSemanticIndex(projectId);
  const status = await built();

  expect(status.phase).toBe(IndexPhase.Ready);
  expect(status.files).toBe(2);
  expect(semantic.hasSemanticIndex(projectId)).toBe(true);

  const hits = await semantic.semanticSearch(projectId, "retry when a card is declined", 2);
  expect(hits?.[0].path).toBe("src/payments/retry.ts");
  expect(lastInputs).toEqual(["Query: retry when a card is declined"]);
});

it("re-embeds nothing when no file changed", async () => {
  embedRequests = 0;
  semantic.buildSemanticIndex(projectId);
  await built();

  expect(embedRequests).toBe(0);
});

it("deletes the index", async () => {
  semantic.removeSemanticIndex(projectId);

  expect(semantic.hasSemanticIndex(projectId)).toBe(false);
  expect(await semantic.semanticSearch(projectId, "retry", 2)).toBeNull();
});
