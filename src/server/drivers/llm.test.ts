import http from "node:http";
import type { AddressInfo } from "node:net";
import type { UIMessage } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProviderKind } from "@/lib/domain";
import { streamChat, type ModelConfig } from "./llm";

// Fake OpenAI-compatible server. Asked "drop", it cuts the connection
// mid-answer, like an overloaded LLM server; otherwise it answers "Hi".
const DROP = "drop";
let server: http.Server;
let cfg: ModelConfig;

function chunk(delta: object, finish: string | null = null): string {
  return `data: ${JSON.stringify({ id: "1", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const part of req) {
      body += part;
    }

    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(chunk({ role: "assistant", content: "Hi" }));
    if (body.includes(DROP)) {
      setTimeout(() => res.destroy(), 20);
      return;
    }

    res.end(`${chunk({}, "stop")}data: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}/v1`;
  cfg = { kind: ProviderKind.Compatible, baseUrl, apiKey: null, name: "m", jsonSchema: false };
});

afterAll(() => {
  server.close();
});

function userMessage(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

describe("streamChat", () => {
  it("reports an upstream failure in the stream instead of aborting it", async () => {
    const response = await streamChat(cfg, {
      instructions: "",
      messages: [userMessage("u", DROP)],
      tools: {},
      onEnd: () => {},
    });

    const body = await response.text();
    expect(body).toContain('"type":"error"');
  });

  it("gives each answer its own id, so a thread saves without clashes", async () => {
    let saved: UIMessage[] = [];
    const turn = async (history: UIMessage[]) => {
      const response = await streamChat(cfg, { instructions: "", messages: history, tools: {}, onEnd: (all) => (saved = all) });
      await response.text();
      return saved;
    };

    const first = await turn([userMessage("u1", "hello")]);
    const second = await turn([...first, userMessage("u2", "again")]);

    const ids = second.map((m) => m.id);
    expect(ids).toHaveLength(4);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
