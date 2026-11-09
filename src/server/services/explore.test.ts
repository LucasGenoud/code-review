import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ProviderKind } from "@/lib/domain";
import type { Model, Project } from "@/server/drivers/schema";
import { exploreTools } from "./explore";
import type { ResolvedModel } from "./providers";

// An explorer against a fake OpenAI-compatible server: it gets the
// assignment and the repository tools, and its report and tokens come back.

const REPORT = "Sessions expire in src/auth.ts:3.";
let server: http.Server;
let model: ResolvedModel;
let lastBody: { messages: { role: string; content: string }[]; tools?: { function: { name: string } }[] } = { messages: [] };

beforeAll(async () => {
  // Explorers may use semantic search, which reads the app database.
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "prr-explore-data-"));
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const part of req) {
      body += part;
    }

    lastBody = JSON.parse(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "1",
        choices: [{ index: 0, message: { role: "assistant", content: REPORT }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));

  const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}/v1`;
  model = {
    model: { contextWindow: 32_000 } as Model,
    label: "fake",
    config: { kind: ProviderKind.Compatible, baseUrl, apiKey: null, name: "m", jsonSchema: false, maxOutputTokens: null },
  };
});

afterAll(() => {
  server.close();
});

it("runs an explorer on the assignment and counts its tokens", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "prr-explore-"));
  fs.writeFileSync(path.join(repo, "auth.ts"), "export const TTL = 3600;\n");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });

  const spent = { input: 0, output: 0 };
  const view = { project: { id: 1, path: repo, name: "shop" } as Project, review: null };
  const report = await exploreTools(view, model, spent).explore.run({ assignment: "How do sessions expire?", focus: "src/auth/**" });

  expect(report).toBe(REPORT);
  expect(spent).toEqual({ input: 100, output: 10 });
  expect(lastBody.messages.at(-1)?.content).toContain("How do sessions expire?\n\nStart from: src/auth/**");
  expect(lastBody.tools?.map((t) => t.function.name)).toContain("read_symbol");
});
