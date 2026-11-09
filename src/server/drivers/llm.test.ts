import http from "node:http";
import type { AddressInfo } from "node:net";
import type { UIMessage } from "ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChatStop, type ChatMetadata } from "@/lib/chat";
import { ProviderKind } from "@/lib/domain";
import { z } from "zod";
import { defineTool, streamChat, type ModelConfig } from "./llm";

// Fake OpenAI-compatible server. Asked "drop", it cuts the connection
// mid-answer, like an overloaded LLM server; asked "long", it stops at its
// output limit; asked "use-tools", it calls `ping` TOOL_ROUNDS times first;
// asked "stall", it announces a next step without a tool call until nudged.
// Otherwise it answers "Hi".
const DROP = "drop";
// Answers "Hi", then never finishes.
const HANG = "hang";
const LONG = "long";
const TOOLS = "use-tools";
const TOOL_ROUNDS = 12;
const STALL = "stall";
const ANNOUNCED = "Let me check the caller:";
const NUDGED = "Automatic note";
let requests = 0;
const OUTPUT_LIMIT = 32_000;
let server: http.Server;
let cfg: ModelConfig;
let lastBody: { max_tokens?: number } = {};

function chunk(delta: object, finish: string | null = null): string {
  return `data: ${JSON.stringify({ id: "1", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const part of req) {
      body += part;
    }

    lastBody = JSON.parse(body);
    requests++;

    res.writeHead(200, { "content-type": "text/event-stream" });
    if (body.includes(STALL) && !body.includes(NUDGED)) {
      res.end(`${chunk({ role: "assistant", content: ANNOUNCED })}${chunk({}, "stop")}data: [DONE]\n\n`);
      return;
    }

    const toolResults = body.split('"role":"tool"').length - 1;
    if (body.includes(TOOLS) && toolResults < TOOL_ROUNDS) {
      const call = { index: 0, id: `c${toolResults}`, type: "function", function: { name: "ping", arguments: "{}" } };
      res.end(`${chunk({ role: "assistant", tool_calls: [call] })}${chunk({}, "tool_calls")}data: [DONE]\n\n`);
      return;
    }

    res.write(chunk({ role: "assistant", content: "Hi" }));
    if (body.includes(HANG)) {
      return;
    }

    if (body.includes(DROP)) {
      setTimeout(() => res.destroy(), 20);
      return;
    }

    res.end(`${chunk({}, body.includes(LONG) ? "length" : "stop")}data: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}/v1`;
  cfg = { kind: ProviderKind.Compatible, baseUrl, apiKey: null, name: "m", jsonSchema: false, maxOutputTokens: null };
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

  it("sends the model's output token limit", async () => {
    const response = await streamChat(
      { ...cfg, maxOutputTokens: OUTPUT_LIMIT },
      { instructions: "", messages: [userMessage("u", "hello")], tools: {}, onEnd: () => {} },
    );
    await response.text();

    expect(lastBody.max_tokens).toBe(OUTPUT_LIMIT);
  });

  it("keeps calling tools until the model answers", async () => {
    const ping = defineTool({ description: "ping", input: z.object({}), run: async () => "pong" });
    let saved: UIMessage[] = [];
    const response = await streamChat(cfg, {
      instructions: "",
      messages: [userMessage("u", TOOLS)],
      tools: { ping },
      onEnd: (all) => (saved = all),
    });
    await response.text();

    const answer = saved.at(-1);
    expect(answer?.parts.some((p) => p.type === "text" && p.text === "Hi")).toBe(true);
    expect((answer?.metadata as ChatMetadata).stop).toBe(ChatStop.Done);
  });

  it("nudges a model that announces a step without calling a tool", async () => {
    const ping = defineTool({ description: "ping", input: z.object({}), run: async () => "pong" });
    let saved: UIMessage[] = [];
    let spent = { input: 0, output: 0 };
    requests = 0;
    const response = await streamChat(cfg, {
      instructions: "",
      messages: [userMessage("u", STALL)],
      tools: { ping },
      onEnd: (all, usage) => {
        saved = all;
        spent = usage;
      },
    });
    await response.text();

    const answer = saved.at(-1);
    const texts = answer?.parts.flatMap((p) => (p.type === "text" ? [p.text] : []));
    expect(requests).toBe(2);
    expect(texts?.join("")).toContain(ANNOUNCED);
    expect(texts?.join("")).toContain("Hi");
    expect(saved.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect((answer?.metadata as ChatMetadata).stop).toBe(ChatStop.Done);
    expect(spent).toEqual({ input: 0, output: 0 });
  });

  it("doesn't nudge without tools", async () => {
    requests = 0;
    const response = await streamChat(cfg, { instructions: "", messages: [userMessage("u", STALL)], tools: {}, onEnd: () => {} });
    await response.text();

    expect(requests).toBe(1);
  });

  it("saves what was answered when stopped", async () => {
    const stop = new AbortController();
    let saved: UIMessage[] = [];
    const response = await streamChat(cfg, {
      instructions: "",
      messages: [userMessage("u", HANG)],
      tools: {},
      signal: stop.signal,
      onEnd: (all) => (saved = all),
    });
    setTimeout(() => stop.abort(), 100);
    await response.text();

    const answer = saved.at(-1);
    expect(answer?.role).toBe("assistant");
    expect(answer?.parts.some((p) => p.type === "text" && p.text === "Hi")).toBe(true);
  });

  it("tells the client an answer hit the output limit", async () => {
    let saved: UIMessage[] = [];
    const response = await streamChat(cfg, {
      instructions: "",
      messages: [userMessage("u", LONG)],
      tools: {},
      onEnd: (all) => (saved = all),
    });
    await response.text();

    expect((saved.at(-1)?.metadata as ChatMetadata).stop).toBe(ChatStop.OutputLimit);
  });
});
