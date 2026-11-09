import { isToolUIPart, type UIMessage } from "ai";
import type { ChatMetadata } from "@/lib/chat";

// Scores one chat answer: which expected files it cites, and what it cost
// to get there. A file counts as cited when its path appears in the
// answer's text, e.g. "src/pay.ts:42" or `src/pay.ts`.

export type AnswerScore = {
  cited: string[];
  missed: string[];
  // Tool calls, and model rounds (each tool round plus the answer).
  toolCalls: number;
  steps: number;
  nudges: number;
  input: number;
  output: number;
  stop: string | null;
};

const STEP_PART = "step-start";

export function scoreAnswer(answer: UIMessage | undefined, files: string[]): AnswerScore {
  const parts = answer?.parts ?? [];
  const text = parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
  const meta = (answer?.metadata ?? {}) as ChatMetadata;

  return {
    cited: files.filter((f) => text.includes(f)),
    missed: files.filter((f) => !text.includes(f)),
    toolCalls: parts.filter(isToolUIPart).length,
    steps: parts.filter((p) => p.type === STEP_PART).length,
    nudges: meta.nudges ?? 0,
    input: meta.usage?.input ?? 0,
    output: meta.usage?.output ?? 0,
    stop: meta.stop ?? null,
  };
}

export type AskSummary = {
  cases: number;
  // Expected files cited, over all cases.
  recall: { hit: number; total: number };
  // Cases citing every expected file.
  complete: number;
  // Means per case.
  toolCalls: number;
  steps: number;
  input: number;
  output: number;
  seconds: number;
  nudged: number;
  unfinished: number;
};

export function summarizeAsk(scores: (AnswerScore & { seconds: number })[]): AskSummary {
  const n = Math.max(scores.length, 1);
  const mean = (pick: (s: AnswerScore & { seconds: number }) => number) => Math.round((10 * scores.reduce((sum, s) => sum + pick(s), 0)) / n) / 10;

  return {
    cases: scores.length,
    recall: { hit: scores.reduce((s, x) => s + x.cited.length, 0), total: scores.reduce((s, x) => s + x.cited.length + x.missed.length, 0) },
    complete: scores.filter((s) => s.missed.length === 0).length,
    toolCalls: mean((s) => s.toolCalls),
    steps: mean((s) => s.steps),
    input: mean((s) => s.input),
    output: mean((s) => s.output),
    seconds: mean((s) => s.seconds),
    nudged: scores.filter((s) => s.nudges > 0).length,
    unfinished: scores.filter((s) => s.stop !== "done").length,
  };
}
