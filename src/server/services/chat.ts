import path from "node:path";
import type { UIMessage } from "ai";
import picomatch from "picomatch";
import { z } from "zod";
import { FindingStatus, ruleKey } from "@/lib/domain";
import type { SandboxLanguage } from "@/lib/sandbox";
import { loadMessages, saveMessages } from "@/server/drivers/chatStore";
import { grep, log, trackedFiles, wordUsages } from "@/server/drivers/git";
import { defineTool, streamChat, type ChatTool } from "@/server/drivers/llm";
import { projectById } from "@/server/drivers/projectStore";
import { addReviewTokens, findingsForReview, reviewById } from "@/server/drivers/reviewStore";
import type { Project, Review } from "@/server/drivers/schema";
import { headContent } from "./diff";
import { InputError } from "./errors";
import { isInside } from "./paths";
import { resolveModel } from "./providers";
import { runCode, usableLanguages } from "./sandbox";
import { rangeLabel } from "./reviews";
import type { RulesSnapshot } from "./rules";

// Chat about a review. The model knows the change and its findings, and can
// read the repo through read-only tools.

const MAX_FILE_LINES = 400;
const MAX_TOOL_LINES = 200;
const DEFAULT_LOG_ENTRIES = 15;
const MAX_LOG_ENTRIES = 50;

export function loadChat(reviewId: number): UIMessage[] {
  return loadMessages(reviewId) as UIMessage[];
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

  return streamChat(model.config, {
    instructions: instructions(review, project) + sandboxNote(languages),
    messages,
    tools: allTools,
    onEnd: (all, usage) => {
      saveMessages(reviewId, all);
      addReviewTokens(reviewId, usage.input, usage.output);
    },
  });
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
Use the tools to read the repository instead of guessing. You can't modify files.

## Project
${project.description || "(no description)"}

## Change overview
${review.summary || "(none)"}

## Findings
${findings || "(none)"}`;
}

function tools(project: Project, review: Review): Record<string, ChatTool> {
  return {
    read_file: defineTool({
      description: "Read a file of the reviewed version, with line numbers. Optionally a line range.",
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
        "Find every line of the reviewed version that mentions an identifier (whole word), e.g. who calls a method. Returns path:line:text.",
      input: z.object({ identifier: z.string().min(1).describe("e.g. savePayment") }),
      run: async ({ identifier }) => {
        const out = await wordUsages(project.path, identifier, review.headSha, 0);
        return capLines(out) || "(no usages)";
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
async function readRepoFile(project: Project, review: Review, file: string): Promise<string | null> {
  const absolute = path.resolve(project.path, file);
  if (!isInside(project.path, absolute)) {
    return null;
  }

  const relative = path.relative(project.path, absolute).split(path.sep).join("/");
  return headContent(project.path, review.headSha, relative);
}

function capLines(text: string): string {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length <= MAX_TOOL_LINES) {
    return lines.join("\n");
  }

  return [...lines.slice(0, MAX_TOOL_LINES), `… ${lines.length - MAX_TOOL_LINES} more`].join("\n");
}
