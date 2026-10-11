import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateText,
  NoObjectGeneratedError,
  Output,
  stepCountIs,
  streamText,
  tool,
  toUIMessageStream,
  type LanguageModel,
  type LanguageModelUsage,
  type ToolSet,
  type UIMessage,
} from "ai";
import type { z } from "zod";
import { ProviderKind } from "@/lib/domain";

// Thin wrapper over the AI SDK so services never touch provider details.
//
//   ModelConfig ──► languageModel() ──► generateObject / generateText / streamChat

export type ModelConfig = {
  kind: ProviderKind;
  baseUrl: string | null;
  apiKey: string | null;
  name: string;
  jsonSchema: boolean;
};

export type Usage = { input: number; output: number };

export type ChatTool<T extends z.ZodType = z.ZodType> = {
  description: string;
  input: T;
  run: (input: z.infer<T>) => Promise<string>;
};

// Keeps `run`'s input typed from the schema while storing tools in one record.
export function defineTool<T extends z.ZodType>(t: ChatTool<T>): ChatTool {
  return t as unknown as ChatTool;
}

const DEFAULT_URLS: Record<ProviderKind, string | null> = {
  [ProviderKind.OpenAI]: "https://api.openai.com/v1",
  [ProviderKind.Anthropic]: "https://api.anthropic.com/v1",
  [ProviderKind.Compatible]: null,
};

const ANTHROPIC_VERSION = "2023-06-01";
const COMPATIBLE_NAME = "compatible";

// Extra attempts when the model returns JSON that fails the schema.
const OBJECT_RETRIES = 2;
const MAX_CHAT_STEPS = 8;

function languageModel(cfg: ModelConfig): LanguageModel {
  const apiKey = cfg.apiKey ?? undefined;
  const baseURL = cfg.baseUrl ?? undefined;

  if (cfg.kind === ProviderKind.Anthropic) {
    return createAnthropic({ apiKey, baseURL })(cfg.name);
  }

  if (cfg.kind === ProviderKind.OpenAI) {
    return createOpenAI({ apiKey, baseURL })(cfg.name);
  }

  if (!baseURL) {
    throw new Error("OpenAI-compatible providers need a base URL");
  }

  return createOpenAICompatible({
    name: COMPATIBLE_NAME,
    baseURL,
    apiKey,
    includeUsage: true,
    supportsStructuredOutputs: cfg.jsonSchema,
  })(cfg.name);
}

function toUsage(u: LanguageModelUsage | undefined): Usage {
  return { input: u?.inputTokens ?? 0, output: u?.outputTokens ?? 0 };
}

type ObjectRequest<T extends z.ZodType> = {
  instructions: string;
  prompt: string;
  schema: T;
  signal?: AbortSignal;
};

// Structured output, validated against `schema`. Retries on invalid JSON,
// which local models produce more often than hosted ones.
export async function generateObject<T extends z.ZodType>(
  cfg: ModelConfig,
  req: ObjectRequest<T>,
): Promise<{ object: z.infer<T>; usage: Usage }> {
  const spent: Usage = { input: 0, output: 0 };

  for (let attempt = 0; ; attempt++) {
    try {
      const result = await generateText({
        model: languageModel(cfg),
        instructions: req.instructions,
        prompt: req.prompt,
        output: Output.object({ schema: req.schema }),
        abortSignal: req.signal,
      });

      const usage = toUsage(result.usage);
      return {
        object: result.output as z.infer<T>,
        usage: { input: usage.input + spent.input, output: usage.output + spent.output },
      };
    } catch (e) {
      if (!NoObjectGeneratedError.isInstance(e) || attempt >= OBJECT_RETRIES) {
        throw e;
      }

      const usage = toUsage(e.usage);
      spent.input += usage.input;
      spent.output += usage.output;
    }
  }
}

export async function generatePlain(
  cfg: ModelConfig,
  req: { instructions: string; prompt: string; signal?: AbortSignal },
): Promise<{ text: string; usage: Usage }> {
  const result = await generateText({
    model: languageModel(cfg),
    instructions: req.instructions,
    prompt: req.prompt,
    abortSignal: req.signal,
  });

  return { text: result.text, usage: toUsage(result.usage) };
}

type ChatRequest = {
  instructions: string;
  messages: UIMessage[];
  tools: Record<string, ChatTool>;
  onEnd: (messages: UIMessage[], usage: Usage) => void;
};

// Streams a chat turn to the browser (useChat protocol), running tools
// server-side. Calls `onEnd` with the full thread to persist it.
export async function streamChat(cfg: ModelConfig, req: ChatRequest): Promise<Response> {
  const tools: ToolSet = {};
  for (const [name, t] of Object.entries(req.tools)) {
    tools[name] = tool({ description: t.description, inputSchema: t.input, execute: t.run });
  }

  const result = streamText({
    model: languageModel(cfg),
    instructions: req.instructions,
    messages: await convertToModelMessages(req.messages),
    tools,
    stopWhen: stepCountIs(MAX_CHAT_STEPS),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: req.messages,
      onEnd: async ({ messages }) => {
        req.onEnd(messages, toUsage(await result.totalUsage));
      },
    }),
  });
}

// Model ids the provider serves (GET /models). Doubles as a connection test.
export async function listModelNames(
  kind: ProviderKind,
  baseUrl: string | null,
  apiKey: string | null,
): Promise<string[]> {
  const url = baseUrl ?? DEFAULT_URLS[kind];
  if (!url) {
    throw new Error("Base URL required");
  }

  const headers: Record<string, string> = {};
  if (kind === ProviderKind.Anthropic) {
    headers["x-api-key"] = apiKey ?? "";
    headers["anthropic-version"] = ANTHROPIC_VERSION;
  } else if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(`${url.replace(/\/+$/, "")}/models`, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => m.id).sort();
}
