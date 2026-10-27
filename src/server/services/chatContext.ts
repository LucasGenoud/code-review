import { isToolUIPart, type UIMessage } from "ai";

// What the model re-reads each turn. Tool outputs (file reads, grep
// results) are most of a conversation's tokens and rarely matter after a
// couple of questions; the model can run the tool again.
//
//   q1 [read_file → 300 lines]  q2 [grep → 80 lines]  q3 [read_file → 200 lines]
//   └──── outputs replaced ────┘└──────── kept (last KEEP_TOOL_TURNS) ────────┘

// Questions whose tool outputs stay in full, counting the current one.
const KEEP_TOOL_TURNS = 2;
const TRIMMED_OUTPUT = "(output removed to save context; run the tool again if needed)";

// The conversation as the model sees it. Stored messages keep everything.
export function trimToolOutputs(messages: UIMessage[]): UIMessage[] {
  const userIndexes = messages.flatMap((m, i) => (m.role === "user" ? [i] : []));
  const keepFrom = userIndexes.at(-KEEP_TOOL_TURNS) ?? 0;

  return messages.map((m, i) => {
    if (i >= keepFrom || m.role !== "assistant") {
      return m;
    }

    return { ...m, parts: m.parts.map(trimPart) };
  });
}

function trimPart(part: UIMessage["parts"][number]): UIMessage["parts"][number] {
  if (!isToolUIPart(part) || part.state !== "output-available") {
    return part;
  }

  return { ...part, output: TRIMMED_OUTPUT };
}
