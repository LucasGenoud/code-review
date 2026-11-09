import { randomUUID } from "node:crypto";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";
import { ChatMode, SUMMARY_PREFIX, type ChatMetadata, type TokenUsage } from "@/lib/chat";
import { FindingStatus, ruleKey } from "@/lib/domain";
import type { SandboxLanguage } from "@/lib/sandbox";
import {
  deleteThread,
  insertThread,
  loadMessages,
  renameThread,
  saveMessages,
  threadById,
  threadsForProject,
  touchThread,
} from "@/server/drivers/chatStore";
import { beginLive, publishLive, stopLive, subscribeLive } from "@/server/drivers/liveStreams";
import { chatStreamResponse, defineTool, generatePlain, streamChat, type ChatTool } from "@/server/drivers/llm";
import { projectById } from "@/server/drivers/projectStore";
import { addReviewTokens, findingsForReview, reviewById } from "@/server/drivers/reviewStore";
import type { ChatThreadRow, Project, Review } from "@/server/drivers/schema";
import { trimToolOutputs } from "./chatContext";
import { chatInstructions, MODE_STEPS } from "./chatPrompts";
import { InputError } from "./errors";
import { resolveModel, type ResolvedModel } from "./providers";
import { readRepoFile, repoMap, repoTools, semanticTools, ToolScope, type RepoView } from "./repoTools";
import { relevantCode } from "./retrieval";
import { semanticSearch } from "./semanticIndex";
import { runCode, usableLanguages } from "./sandbox";
import { rangeLabel } from "./reviews";
import type { RulesSnapshot } from "./rules";

// Chat about a review, or about a project's codebase. The model reads the
// repository through read-only tools (see repoTools): the reviewed version
// for a review, the working tree for the codebase. Each message carries a
// mode (Ask, Debug, Find bugs, Plan) picking its instructions and tool
// budget (see chatPrompts). Codebase conversations are kept as a history
// of threads, and can be compacted into a summary:
//
//   [q1, a1, q2, a2, …] ──compact──► [summary] ──► [summary, q3, a3, …]

const MAX_TITLE_LENGTH = 80;
// Repository map in the system prompt: this share of the context window,
// at most MAX_MAP_CHARS.
const MAP_SHARE = 0.05;
const MAX_MAP_CHARS = 12_000;
// Code retrieved for the question (see retrieval): this share, at most
// MAX_SEED_CHARS.
const SEED_SHARE = 0.04;
const MAX_SEED_CHARS = 10_000;
// Semantic search chunks fused into the seed.
const SEED_SEMANTIC_HITS = 12;
const SEED_HEADING = `## Likely relevant code
Found by matching the question's words against the repository; lexical, so it can miss synonyms or include noise. Not shown to the developer.`;
// The answer is forced once the conversation fills this share of the window.
const CONTEXT_SHARE = 0.85;

// Compaction sends at most this share of the context window, the latest
// messages first. ~4 characters per token.
const COMPACT_SHARE = 0.5;
const CHARS_PER_TOKEN = 4;

export type ThreadSummary = Pick<ChatThreadRow, "id" | "title" | "updatedAt">;

// What the codebase chat runs on, for the token meter.
export type ChatModelInfo = {
  label: string;
  contextWindow: number;
  // USD per million tokens; null = unknown.
  inputCost: number | null;
  outputCost: number | null;
};

export function loadChat(reviewId: number): UIMessage[] {
  return loadMessages({ reviewId }) as UIMessage[];
}

export function listThreads(projectId: number): ThreadSummary[] {
  return threadsForProject(projectId).map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
}

export function loadThread(projectId: number, threadId: number): UIMessage[] {
  ownThread(projectId, threadId);
  return loadMessages({ threadId }) as UIMessage[];
}

// A new conversation, titled by its first question's first line.
export function startThread(projectId: number, question: string): ThreadSummary {
  if (!projectById(projectId)) {
    throw new InputError("Unknown project");
  }

  const { id, title, updatedAt } = insertThread(projectId, threadTitle(question));
  return { id, title, updatedAt };
}

export function renameCodebaseThread(projectId: number, threadId: number, title: string): void {
  ownThread(projectId, threadId);
  renameThread(threadId, threadTitle(title));
}

export function removeThread(projectId: number, threadId: number): void {
  ownThread(projectId, threadId);
  deleteThread(threadId);
}

export function codebaseModel(projectId: number): ChatModelInfo | null {
  const project = projectById(projectId);
  if (!project) {
    return null;
  }

  try {
    const { model, label } = resolveModel(project.modelId);
    return { label, contextWindow: model.contextWindow, inputCost: model.inputCost, outputCost: model.outputCost };
  } catch {
    return null;
  }
}

// A working tree file cited in an answer, for the file viewer. Read-only.
export async function codebaseFile(projectId: number, file: string): Promise<string> {
  const project = projectById(projectId);
  const content = project && (await readRepoFile({ project, review: null }, file));
  if (!content) {
    throw new InputError(`Can't open ${file}`);
  }

  return content;
}

function threadTitle(text: string): string {
  const line = text.trim().split("\n")[0].trim();
  return line.length > MAX_TITLE_LENGTH ? `${line.slice(0, MAX_TITLE_LENGTH - 1)}…` : line;
}

// The thread, if it belongs to the project. Ids come from the browser.
function ownThread(projectId: number, threadId: number): ChatThreadRow {
  const thread = threadById(threadId);
  if (!thread || thread.projectId !== projectId) {
    throw new InputError("Unknown conversation");
  }

  return thread;
}

// mode: from the browser; anything unknown is a question.
export async function chatResponse(reviewId: number, messages: UIMessage[], mode: unknown): Promise<Response> {
  const review = reviewById(reviewId);
  const project = review && projectById(review.projectId);
  if (!review || !project) {
    throw new InputError("Unknown review");
  }

  const model = resolveModel(review.modelId);
  const setup = await turnSetup({ project, review }, model, parseMode(mode), reviewContext(review), messages);

  // The question is kept even if the answer never completes.
  saveMessages({ reviewId }, messages);
  const key = reviewKey(reviewId);
  const response = await streamChat(model.config, {
    ...setup,
    messages,
    signal: beginLive(key),
    onEnd: (all, usage) => {
      saveMessages({ reviewId }, all);
      addReviewTokens(reviewId, usage.input, usage.output);
    },
  });
  return live(key, response);
}

// The answer being generated, for a reloaded page; null when none.
export function resumeReviewChat(reviewId: number): Response | null {
  return resumed(reviewKey(reviewId));
}

export function stopReviewChat(reviewId: number): void {
  stopLive(reviewKey(reviewId));
}

export function resumeProjectChat(projectId: number, threadId: number): Response | null {
  ownThread(projectId, threadId);
  return resumed(threadKey(threadId));
}

export function stopProjectChat(projectId: number, threadId: number): void {
  ownThread(projectId, threadId);
  stopLive(threadKey(threadId));
}

function reviewKey(reviewId: number): string {
  return `review:${reviewId}`;
}

function threadKey(threadId: number): string {
  return `thread:${threadId}`;
}

// Generation continues if the browser leaves; see liveStreams.
function live(key: string, response: Response): Response {
  if (!response.body) {
    return response;
  }

  return chatStreamResponse(publishLive(key, response.body));
}

function resumed(key: string): Response | null {
  const stream = subscribeLive(key);
  return stream && chatStreamResponse(stream);
}

// Questions about the codebase, answered from the working tree.
export async function projectChatResponse(projectId: number, threadId: number, messages: UIMessage[], mode: unknown): Promise<Response> {
  ownThread(projectId, threadId);
  const project = projectById(projectId);
  if (!project) {
    throw new InputError("Unknown project");
  }

  const model = resolveModel(project.modelId);
  const setup = await turnSetup({ project, review: null }, model, parseMode(mode), "", messages);

  saveMessages({ threadId }, messages);
  const key = threadKey(threadId);
  const response = await streamChat(model.config, {
    ...setup,
    messages,
    signal: beginLive(key),
    onEnd: (all) => {
      saveMessages({ threadId }, all);
      touchThread(threadId);
    },
  });
  return live(key, response);
}

// Replaces the thread with a summary of it, to free the context window.
// Returns the new thread.
export async function compactThread(projectId: number, threadId: number): Promise<UIMessage[]> {
  ownThread(projectId, threadId);
  const project = projectById(projectId);
  const messages = loadMessages({ threadId }) as UIMessage[];
  if (!project || messages.length === 0) {
    throw new InputError("Nothing to compact");
  }

  const { model, config } = resolveModel(project.modelId);
  const maxChars = Math.floor(model.contextWindow * COMPACT_SHARE * CHARS_PER_TOKEN);
  const { text, usage } = await generatePlain(config, {
    instructions: compactInstructions(project),
    prompt: transcript(messages).slice(-maxChars),
  });

  const spent = messages.reduce<TokenUsage>((sum, m) => addUsage(sum, (m.metadata as ChatMetadata | undefined)?.usage), usage);
  const metadata: ChatMetadata = { summary: true, usage: spent, context: usage.output };
  const summary: UIMessage = { id: randomUUID(), role: "user", parts: [{ type: "text", text: SUMMARY_PREFIX + text }], metadata };

  saveMessages({ threadId }, [summary]);
  touchThread(threadId);
  return [summary];
}

function compactInstructions(project: Project): string {
  return `Summarize this conversation between a developer and an assistant about the project "${project.name}", so the assistant can continue it without the original messages.
Keep: the questions asked, the conclusions of the answers, file paths with line numbers, identifiers, short code that matters, decisions, open questions.
Drop: pleasantries, tool chatter, repeated content. Use short bullet points under headings.`;
}

// Text and tool calls; tool outputs are left out, the model can re-read files.
// e.g. "## Developer\nWhere are keys stored?\n\n## Assistant\n[grep {"pattern":"apiKey"}]\nIn crypto.ts…"
function transcript(messages: UIMessage[]): string {
  return messages
    .map((m) => {
      const parts = m.parts.map((p) => {
        if (p.type === "text") {
          return p.text;
        }

        return isToolUIPart(p) ? `[${getToolName(p)} ${JSON.stringify(p.input)}]` : "";
      });
      return `## ${m.role === "user" ? "Developer" : "Assistant"}\n${parts.filter(Boolean).join("\n")}`;
    })
    .join("\n\n");
}

function addUsage(sum: TokenUsage, usage: TokenUsage | undefined): TokenUsage {
  return { input: sum.input + (usage?.input ?? 0), output: sum.output + (usage?.output ?? 0) };
}

function parseMode(mode: unknown): ChatMode {
  return z.enum(ChatMode).catch(ChatMode.Ask).parse(mode);
}

// Instructions, tools, budget and model-side history of one chat turn.
async function turnSetup(view: RepoView, model: ResolvedModel, mode: ChatMode, context: string, messages: UIMessage[]) {
  const toolCalling = model.model.toolCalling;
  const contextWindow = model.model.contextWindow;
  const mapChars = Math.min(MAX_MAP_CHARS, Math.floor(contextWindow * MAP_SHARE * CHARS_PER_TOKEN));
  const seedChars = Math.min(MAX_SEED_CHARS, Math.floor(contextWindow * SEED_SHARE * CHARS_PER_TOKEN));
  const [languages, map, seed] = await Promise.all([
    toolCalling ? usableLanguages() : [],
    toolCalling ? repoMap(view, mapChars) : "",
    seedFor(view, latestQuestion(messages), seedChars),
  ]);

  const instructions = chatInstructions({
    mode,
    project: view.project,
    context,
    repoMap: map,
    languages,
    tools: toolCalling,
  });

  return {
    instructions,
    history: withSeed(trimToolOutputs(messages), seed),
    tools: toolCalling ? { ...repoTools(view, ToolScope.Chat), ...semanticTools(view), ...sandboxTools(view.project, languages) } : {},
    budget: { steps: MODE_STEPS[mode], contextTokens: Math.floor(model.model.contextWindow * CONTEXT_SHARE) },
  };
}

// Code likely relevant to the question: word matches, fused with meaning
// matches when the project has a semantic index. "" on failure: the turn
// goes on without it.
async function seedFor(view: RepoView, question: string, budget: number): Promise<string> {
  if (!question) {
    return "";
  }

  const semantic = (await semanticSearch(view.project.id, question, SEED_SEMANTIC_HITS).catch(() => null)) ?? [];
  return relevantCode(view, question, budget, semantic).catch(() => "");
}

// Text of the last user message; "" for a compaction summary.
function latestQuestion(messages: UIMessage[]): string {
  const last = messages.findLast((m) => m.role === "user");
  const text = (last?.parts ?? []).flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
  return text.startsWith(SUMMARY_PREFIX) ? "" : text;
}

// The retrieved code rides on the latest question, not the system prompt:
// the prompt stays identical across turns (provider prompt caching), and
// older questions drop their seed. Stored messages never carry it.
function withSeed(history: UIMessage[], seed: string): UIMessage[] {
  const at = history.findLastIndex((m) => m.role === "user");
  if (!seed || at < 0) {
    return history;
  }

  const question = history[at];
  const seeded = { ...question, parts: [...question.parts, { type: "text" as const, text: `${SEED_HEADING}\n${seed}` }] };
  return history.with(at, seeded);
}

// What the review chat knows beyond the code: range, overview, findings.
function reviewContext(review: Review): string {
  const rules: RulesSnapshot = JSON.parse(review.rules);
  const categories = new Map(rules.categories.map((c) => [c.id, c.name]));

  const findings = findingsForReview(review.id)
    .filter((f) => f.status !== FindingStatus.Fixed)
    .map((f) => {
      const where = `${f.path}:${f.startLine}-${f.endLine}`;
      const tag = `${categories.get(f.categoryId) ?? "?"} ${ruleKey(f.ruleId)}, ${f.severity}, ${f.status}`;
      return `#${f.id} ${where} [${tag}] ${f.title}: ${f.explanation}`;
    })
    .join("\n");

  return `## Review
The developer is working through a code review of their change. Range reviewed: ${rangeLabel(review)}. The tools read the reviewed version. Findings are referred to as #<id>; when asked whether one is right, check it against the code and say plainly if it is a false positive.

## Change overview
${review.summary || "(none)"}

## Findings
${findings || "(none)"}`;
}

// run_code, only when the sandbox is enabled and its runner is online.
function sandboxTools(project: Project, languages: SandboxLanguage[]): Record<string, ChatTool> {
  if (languages.length === 0) {
    return {};
  }

  return {
    run_code: defineTool({
      description: "Run a short program in the isolated sandbox and get its exit code, stdout and stderr.",
      input: z.object({
        language: z.enum(languages as [SandboxLanguage, ...SandboxLanguage[]]),
        code: z.string().describe("Complete program. Java: one source file whose first class has main()."),
      }),
      run: ({ language, code }) => runCode(language, code, project.path),
    }),
  };
}
