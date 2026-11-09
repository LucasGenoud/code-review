import type { UIMessage } from "ai";
import { expect, it } from "vitest";
import { ChatStop } from "@/lib/chat";
import { scoreAnswer, summarizeAsk } from "./score";

const ANSWER: UIMessage = {
  id: "a",
  role: "assistant",
  metadata: { usage: { input: 900, output: 100 }, stop: ChatStop.Done, nudges: 1 },
  parts: [
    { type: "step-start" },
    { type: "tool-locate", toolCallId: "1", state: "output-available", input: { terms: ["key"] }, output: "…" },
    { type: "tool-read_symbol", toolCallId: "2", state: "output-available", input: { names: ["encrypt"] }, output: "…" },
    { type: "step-start" },
    { type: "text", text: "Keys are sealed in `src/server/drivers/crypto.ts:12`." },
  ],
};

it("scores cited files, tool calls, rounds and tokens", () => {
  const score = scoreAnswer(ANSWER, ["src/server/drivers/crypto.ts", "src/server/services/providers.ts"]);

  expect(score).toEqual({
    cited: ["src/server/drivers/crypto.ts"],
    missed: ["src/server/services/providers.ts"],
    toolCalls: 2,
    steps: 2,
    nudges: 1,
    input: 900,
    output: 100,
    stop: ChatStop.Done,
  });
});

it("summarizes recall, complete cases and means", () => {
  const a = { ...scoreAnswer(ANSWER, ["src/server/drivers/crypto.ts"]), seconds: 10 };
  const b = { ...scoreAnswer(undefined, ["x.ts"]), seconds: 20 };
  const summary = summarizeAsk([a, b]);

  expect(summary.recall).toEqual({ hit: 1, total: 2 });
  expect(summary.complete).toBe(1);
  expect(summary.toolCalls).toBe(1);
  expect(summary.seconds).toBe(15);
  expect(summary.nudged).toBe(1);
  expect(summary.unfinished).toBe(1);
});
