import { randomUUID } from "node:crypto";
import path from "node:path";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import picomatch from "picomatch";
import { z } from "zod";
import { SUMMARY_PREFIX, type ChatMetadata, type TokenUsage } from "@/lib/chat";
import { DiffMode, FindingStatus, ruleKey } from "@/lib/domain";
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
import { grep, grepAt, log, trackedFiles, wordUsages } from "@/server/drivers/git";
import { beginLive, publishLive, stopLive, subscribeLive } from "@/server/drivers/liveStreams";
import { chatStreamResponse, defineTool, generatePlain, streamChat, type ChatTool } from "@/server/drivers/llm";
import { projectById } from "@/server/drivers/projectStore";
import { addReviewTokens, filesForReview, findingsForReview, reviewById } from "@/server/drivers/reviewStore";
import type { ChatThreadRow, Project, Review } from "@/server/drivers/schema";
import { trimToolOutputs } from "./chatContext";
import { headContent } from "./diff";
import { parseDiff } from "./diffParse";
import { InputError } from "./errors";
import { isInside } from "./paths";
import { resolveModel } from "./providers";
import { runCode, usableLanguages } from "./sandbox";
import { rangeLabel } from "./reviews";
import { definitionPattern, outline } from "./symbols";
import type { RulesSnapshot } from "./rules";

// Chat about a review, or about a project's codebase. The model reads the
// repository through read-only tools: the reviewed version for a review,
// the working tree for the codebase. Codebase conversations are kept as a
// history of threads, and can be compacted into a summary:
//
//   [q1, a1, q2, a2, …] ──compact──► [summary] ──► [summary, q3, a3, …]

const MAX_FILE_LINES = 400;
const MAX_TOOL_LINES = 200;
const DEFAULT_LOG_ENTRIES = 15;
const MAX_LOG_ENTRIES = 50;
const MAX_TITLE_LENGTH = 80;
// e.g. savePayment, $store, user_id.
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

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
  const content = project && (await readRepoFile(project, null, file));
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

export async function chatResponse(reviewId: number, messages: UIMessage[]): Promise<Response> {
  const review = reviewById(reviewId);
  const project = review && projectById(review.projectId);
  if (!review || !project) {
    throw new InputError("Unknown review");
  }

  const model = resolveModel(review.modelId);
  const languages = model.model.toolCalling ? await usableLanguages() : [];
  const allTools = model.model.toolCalling ? { ...tools(project, review), ...sandboxTools(project, languages) } : {};

  // The question is kept even if the answer never completes.
  saveMessages({ reviewId }, messages);
  const key = reviewKey(reviewId);
  const response = await streamChat(model.config, {
    instructions: instructions(review, project) + sandboxNote(languages),
    messages,
    history: trimToolOutputs(messages),
    tools: allTools,
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
export async function projectChatResponse(projectId: number, threadId: number, messages: UIMessage[]): Promise<Response> {
  ownThread(projectId, threadId);
  const project = projectById(projectId);
  if (!project) {
    throw new InputError("Unknown project");
  }

  const model = resolveModel(project.modelId);
  const languages = model.model.toolCalling ? await usableLanguages() : [];
  const allTools = model.model.toolCalling ? { ...tools(project, null), ...sandboxTools(project, languages) } : {};

  saveMessages({ threadId }, messages);
  const key = threadKey(threadId);
  const response = await streamChat(model.config, {
    instructions: projectInstructions(project) + sandboxNote(languages),
    messages,
    history: trimToolOutputs(messages),
    tools: allTools,
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

function projectInstructions(project: Project): string {
  return `You answer a developer's questions about their project "${project.name}": how it works, where things are, what a piece of code does.
Use the tools to read the repository instead of guessing: outline a file or find_definition before reading whole files. Cite files as path:line. Answer concisely; quote code when useful. You can't modify files.

## Project
${project.description || "(no description)"}`;
}

function instructions(review: Review, project: Project): string {
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

  return `You help a developer understand a code review of their project "${project.name}".
Range reviewed: ${rangeLabel(review)}.
Users refer to findings as #<id>. Answer concisely; quote code when useful.
Use the tools to read the repository instead of guessing: outline a file or find_definition before reading whole files. You can't modify files.

## Project
${project.description || "(no description)"}

## Change overview
${review.summary || "(none)"}

## Findings
${findings || "(none)"}`;
}

// review null = the working tree.
function tools(project: Project, review: Review | null): Record<string, ChatTool> {
  return {
    read_file: defineTool({
      description: `Read a file of the ${review ? "reviewed version" : "working tree"}, with line numbers. Optionally a line range.`,
      input: z.object({
        path: z.string().describe("Path relative to the repository root"),
        startLine: z.number().int().min(1).nullable(),
        endLine: z.number().int().min(1).nullable(),
      }),
      run: async ({ path: file, startLine, endLine }) => {
        const content = await readRepoFile(project, review, file);
        if (content === null) {
          return "Error: file not found or outside the repository";
        }

        const lines = content.split(/\r?\n/);
        const from = startLine ?? 1;
        const to = Math.min(endLine ?? lines.length, from + MAX_FILE_LINES - 1);
        return lines
          .slice(from - 1, to)
          .map((l, i) => `${from + i}: ${l}`)
          .join("\n");
      },
    }),
    grep: defineTool({
      description: "Search tracked files with a regular expression (git grep -E). Returns path:line:text.",
      input: z.object({
        pattern: z.string(),
        glob: z.string().nullable().describe("Optional pathspec, e.g. *.py"),
      }),
      run: async ({ pattern, glob }) => {
        const out = await grep(project.path, pattern, glob ?? undefined);
        return capLines(out) || "(no matches)";
      },
    }),
    find_usages: defineTool({
      description:
        "Find every line of the repository that mentions an identifier (whole word), e.g. who calls a method. Returns path:line:text.",
      input: z.object({ identifier: z.string().min(1).describe("e.g. savePayment") }),
      run: async ({ identifier }) => {
        const out = await wordUsages(project.path, identifier, review?.headSha ?? null, 0);
        return capLines(out) || "(no usages)";
      },
    }),
    find_definition: defineTool({
      description:
        "Find where an identifier is declared (function, class, method, type, constant), across languages. Returns path:line:text. Cheaper than reading files.",
      input: z.object({ identifier: z.string().regex(IDENTIFIER).describe("e.g. savePayment") }),
      run: async ({ identifier }) => {
        const out = await grepAt(project.path, definitionPattern(identifier), review?.headSha ?? null);
        return capLines(out) || "(no definition found; try find_usages or grep)";
      },
    }),
    outline: defineTool({
      description: "List a file's declarations (classes, functions, methods) with line numbers, to find what to read.",
      input: z.object({ path: z.string().describe("Path relative to the repository root") }),
      run: async ({ path: file }) => {
        const content = await readRepoFile(project, review, file);
        if (content === null) {
          return "Error: file not found or outside the repository";
        }

        return capLines(outline(content).join("\n")) || "(no declarations found)";
      },
    }),
    list_files: defineTool({
      description: "List tracked files, optionally filtered by a glob like src/**/*.ts.",
      input: z.object({ glob: z.string().nullable() }),
      run: async ({ glob }) => {
        const files = await trackedFiles(project.path);
        const matches = glob ? picomatch(glob, { dot: true }) : () => true;
        return capLines(files.filter((f) => matches(f)).join("\n")) || "(no files)";
      },
    }),
    git_log: defineTool({
      description: "Recent commits, optionally for one file.",
      input: z.object({
        path: z.string().nullable(),
        limit: z.number().int().min(1).max(MAX_LOG_ENTRIES).nullable(),
      }),
      run: async ({ path: file, limit }) => {
        return log(project.path, file ?? undefined, limit ?? DEFAULT_LOG_ENTRIES);
      },
    }),
  };
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

function sandboxNote(languages: SandboxLanguage[]): string {
  if (languages.length === 0) {
    return "";
  }

  return `

## Sandbox
run_code executes code in an isolated sandbox (${languages.join(", ")}): no network, a temporary working directory, the project's working tree read-only at $REPO (Python can import project modules; Node resolves $REPO/node_modules). Use it to confirm or refute a suspected behavior with a minimal reproduction, then report what the output shows. Keep programs small and deterministic.`;
}

// Paths come from the model: keep them inside the repository.
async function readRepoFile(project: Project, review: Review | null, file: string): Promise<string | null> {
  if (review?.mode === DiffMode.Pasted) {
    return pastedContent(review, file);
  }

  const absolute = path.resolve(project.path, file);
  if (!isInside(project.path, absolute)) {
    return null;
  }

  const relative = path.relative(project.path, absolute).split(path.sep).join("/");
  return headContent(project.path, review?.headSha ?? null, relative);
}

// A pasted file, rebuilt from its whole-file patch.
function pastedContent(review: Review, file: string): string | null {
  const row = filesForReview(review.id).find((f) => f.path === file);
  const parsed = row && parseDiff(row.patch)[0];
  if (!parsed) {
    return null;
  }

  return parsed.hunks.flatMap((h) => h.lines.map((l) => l.text)).join("\n");
}

function capLines(text: string): string {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length <= MAX_TOOL_LINES) {
    return lines.join("\n");
  }

  return [...lines.slice(0, MAX_TOOL_LINES), `… ${lines.length - MAX_TOOL_LINES} more`].join("\n");
}
