import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { trimToolOutputs } from "./chatContext";

function question(id: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text: id }] };
}

function answer(id: string, output: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      { type: "tool-read_file", toolCallId: `c${id}`, state: "output-available", input: { path: "a.ts" }, output },
      { type: "text", text: "done" },
    ],
  };
}

function outputOf(message: UIMessage): unknown {
  const part = message.parts[0] as { output?: unknown };
  return part.output;
}

describe("trimToolOutputs", () => {
  it("keeps the tool outputs of the last two questions", () => {
    const messages = [question("q1"), answer("a1", "one"), question("q2"), answer("a2", "two"), question("q3"), answer("a3", "three")];

    const trimmed = trimToolOutputs(messages);

    expect(outputOf(trimmed[1])).not.toBe("one");
    expect(outputOf(trimmed[3])).toBe("two");
    expect(outputOf(trimmed[5])).toBe("three");
  });

  it("leaves text and the stored messages untouched", () => {
    const messages = [question("q1"), answer("a1", "one"), question("q2"), question("q3")];

    const trimmed = trimToolOutputs(messages);

    expect(trimmed[1].parts[1]).toEqual({ type: "text", text: "done" });
    expect(outputOf(messages[1])).toBe("one");
  });
});
