import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateId,
  generateText,
  NoObjectGeneratedError,
  Output,
  stepCountIs,
  streamText,
  tool,
  toUIMessageStream,
  UI_MESSAGE_STREAM_HEADERS,
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
  type TextStreamPart,
  type ToolSet,
  type UIMessage,
} from "ai";
import type { z } from "zod";
import { ChatStop, type ChatMetadata } from "@/lib/chat";
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
  // Null = the provider's default, which can be as low as 4096.
  maxOutputTokens: number | null;
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
// Tool calls plus the answer, when the request sets no budget.
const MAX_CHAT_STEPS = 30;
// Added to the instructions of the last allowed step, which can't call tools.
const BUDGET_SPENT = "\n\nYour tool budget is used up: answer now from what you found, and name what you would check next.";

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
        maxOutputTokens: cfg.maxOutputTokens ?? undefined,
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

type AgentRequest<T extends z.ZodType> = ObjectRequest<T> & {
  tools: Record<string, ChatTool>;
  budget: Budget;
  // Before each tool runs, e.g. to show "Reading src/pay.ts:40-90".
  onTool?: (name: string, input: unknown) => void;
};

// Structured output after a tool loop: the model explores with `tools`,
// then answers in `schema`. The last allowed step can't call tools, so
// the loop always ends with an answer. Returns the tool calls made, e.g.
// ['read_symbol {"name":"balance"}'], for the prompt preview.
export async function generateAgentObject<T extends z.ZodType>(
  cfg: ModelConfig,
  req: AgentRequest<T>,
): Promise<{ object: z.infer<T>; usage: Usage; trace: string[] }> {
  const { result, trace } = await toolLoop(cfg, req, Output.object({ schema: req.schema }));
  return { object: result.output as z.infer<T>, usage: toUsage(result.totalUsage), trace };
}

// A tool loop ending in plain text, e.g. an agent that acts through its
// tools and only reports at the end.
export async function generateAgentText(
  cfg: ModelConfig,
  req: Omit<AgentRequest<z.ZodType>, "schema">,
): Promise<{ text: string; usage: Usage; trace: string[] }> {
  const { result, trace } = await toolLoop(cfg, req, undefined);
  return { text: result.text, usage: toUsage(result.totalUsage), trace };
}

async function toolLoop(cfg: ModelConfig, req: Omit<AgentRequest<z.ZodType>, "schema">, output: Parameters<typeof generateText>[0]["output"]) {
  const trace: string[] = [];
  const result = await generateText({
    model: languageModel(cfg),
    instructions: req.instructions,
    prompt: req.prompt,
    tools: toolSet(req.tools),
    output,
    stopWhen: stepCountIs(req.budget.steps),
    prepareStep: ({ stepNumber, steps }) => finalStep(stepNumber, steps, req.budget, req.instructions),
    maxOutputTokens: cfg.maxOutputTokens ?? undefined,
    abortSignal: req.signal,
    onToolExecutionStart: ({ toolCall }) => {
      trace.push(`${toolCall.toolName} ${JSON.stringify(toolCall.input)}`);
      req.onTool?.(toolCall.toolName, toolCall.input);
    },
  });

  return { result, trace };
}

function toolSet(tools: Record<string, ChatTool>): ToolSet {
  const set: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    set[name] = tool({ description: t.description, inputSchema: t.input, execute: t.run });
  }

  return set;
}

export async function generatePlain(
  cfg: ModelConfig,
  req: { instructions: string; prompt: string; signal?: AbortSignal },
): Promise<{ text: string; usage: Usage }> {
  const result = await generateText({
    model: languageModel(cfg),
    instructions: req.instructions,
    prompt: req.prompt,
    maxOutputTokens: cfg.maxOutputTokens ?? undefined,
    abortSignal: req.signal,
  });

  return { text: result.text, usage: toUsage(result.usage) };
}

type ChatPart = TextStreamPart<ToolSet>;

type ChatRequest = {
  instructions: string;
  // The whole thread, persisted by onEnd.
  messages: UIMessage[];
  // What the model sees, e.g. with old tool outputs trimmed. Default: messages.
  history?: UIMessage[];
  tools: Record<string, ChatTool>;
  // Tool rounds, and context tokens after which the model must answer.
  budget?: Budget;
  // Stops the answer; onEnd still saves what was generated.
  signal?: AbortSignal;
  onEnd: (messages: UIMessage[], usage: Usage) => void;
};

// Streams a chat turn to the browser (useChat protocol), running tools
// server-side. Calls `onEnd` with the full thread to persist it. The answer
// carries ChatMetadata: tokens spent, context size, why it stopped.
export async function streamChat(cfg: ModelConfig, req: ChatRequest): Promise<Response> {
  const tools = toolSet(req.tools);
  const budget = req.budget ?? { steps: MAX_CHAT_STEPS, contextTokens: Infinity };
  const result = streamText({
    model: languageModel(cfg),
    instructions: req.instructions,
    messages: await convertToModelMessages(req.history ?? req.messages),
    tools,
    stopWhen: stepCountIs(budget.steps),
    prepareStep: ({ stepNumber, steps }) => finalStep(stepNumber, steps, budget, req.instructions),
    maxOutputTokens: cfg.maxOutputTokens ?? undefined,
    abortSignal: req.signal,
  });

  // The last step's tokens are what the next turn sends again.
  let context = 0;

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: endOnError(result.stream),
      originalMessages: req.messages,
      // Without it answers get id "", which clash when the thread is saved.
      generateMessageId: generateId,
      messageMetadata: ({ part }): ChatMetadata | undefined => {
        if (part.type === "finish-step") {
          context = (part.usage.inputTokens ?? 0) + (part.usage.outputTokens ?? 0);
          return undefined;
        }

        if (part.type !== "finish") {
          return undefined;
        }

        return { usage: toUsage(part.totalUsage), context, stop: chatStop(part.finishReason) };
      },
      // Show the real cause, e.g. "Failed to process successful response".
      onError: (e) => (e instanceof Error ? e.message : String(e)),
      onEnd: async ({ messages }) => {
        // Rejects when the model failed; rethrowing here would abort the
        // response mid-stream ("Error in input stream" in the browser).
        const usage = await Promise.resolve(result.totalUsage).catch(() => undefined);
        req.onEnd(messages, toUsage(usage));
      },
    }),
  });
}

export type Budget = { steps: number; contextTokens: number };

// Forces the answer on the last allowed step, or once the conversation
// nears the context window: no tools, and a note saying why. Without it a
// long investigation ends on a tool call, with no answer at all.
function finalStep(
  stepNumber: number,
  steps: { usage: LanguageModelUsage }[],
  budget: Budget,
  instructions: string,
): { toolChoice?: "none"; instructions?: string } {
  const last = steps.at(-1)?.usage;
  const context = (last?.inputTokens ?? 0) + (last?.outputTokens ?? 0);
  if (stepNumber < budget.steps - 1 && context < budget.contextTokens) {
    return {};
  }

  return { toolChoice: "none", instructions: instructions + BUDGET_SPENT };
}

// A chat stream's bytes (e.g. replayed) as a useChat response.
export function chatStreamResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { headers: UI_MESSAGE_STREAM_HEADERS });
}

// "tool-calls" on the last step = the step limit cut the loop.
function chatStop(reason: FinishReason): ChatStop {
  if (reason === "length") {
    return ChatStop.OutputLimit;
  }

  return reason === "tool-calls" ? ChatStop.StepLimit : ChatStop.Done;
}

// The SDK rethrows a dropped model connection instead of emitting an error
// part; turn it into one so the browser gets a readable error, not a broken
// response ("Error in input stream").
function endOnError(stream: ReadableStream<ChatPart>): ReadableStream<ChatPart> {
  const reader = stream.getReader();
  return new ReadableStream<ChatPart>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }

        controller.enqueue(value);
      } catch (error) {
        controller.enqueue({ type: "error", error });
        controller.close();
      }
    },
    cancel: (reason) => reader.cancel(reason),
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
