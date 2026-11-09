// Chat message metadata shared by server and UI. Client-safe.

// Why an answer ended.
export enum ChatStop {
  Done = "done",
  // Hit the model's output token limit mid-answer.
  OutputLimit = "output_limit",
  // Hit the tool step limit before answering.
  StepLimit = "step_limit",
}

export type TokenUsage = { input: number; output: number };

// Attached to assistant messages, and to the summary that replaces a
// compacted conversation.
export type ChatMetadata = {
  // Tokens this answer cost. On a summary: everything it replaced, plus
  // the summary itself.
  usage?: TokenUsage;
  // Tokens the model sees on the next turn, e.g. 12_400 of a 200k window.
  context?: number;
  stop?: ChatStop;
  // Times the turn was continued after stopping short (see streamChat).
  nudges?: number;
  summary?: boolean;
};

// Starts the message that replaces a compacted conversation; tells the
// model it is a summary, not a question.
export const SUMMARY_PREFIX = "Summary of our conversation so far (earlier messages were compacted):\n\n";

// What a chat turn is for. Each mode has its own instructions and tool
// budget on the server (see chatPrompts), and its own hint in the composer.
export enum ChatMode {
  // How does X work, where is Y: explain with citations.
  Ask = "ask",
  // A specific problem (error, wrong output): find the root cause.
  Debug = "debug",
  // Audit an area for bugs, e.g. "the refund flow".
  Hunt = "hunt",
  // How to implement a change: files, steps, risks.
  Plan = "plan",
}

export const CHAT_MODES: Record<ChatMode, { label: string; hint: string; placeholder: string }> = {
  [ChatMode.Ask]: {
    label: "Ask",
    hint: "Explain code, find where things are",
    placeholder: "Ask about the code, e.g. Where are API keys stored?",
  },
  [ChatMode.Debug]: {
    label: "Debug",
    hint: "Find the root cause of a specific problem",
    placeholder: "Describe the problem: error, input, expected vs actual…",
  },
  [ChatMode.Hunt]: {
    label: "Find bugs",
    hint: "Audit an area or feature for bugs",
    placeholder: "Name an area to audit, e.g. the payment retry logic",
  },
  [ChatMode.Plan]: {
    label: "Plan",
    hint: "Plan a change: files to touch, steps, risks",
    placeholder: "Describe the change, e.g. Add CSV export to reports",
  },
};

// Answers end with "Follow-ups: q1 | q2 | q3" (see chatPrompts); the chat
// shows them as buttons instead of text.
const FOLLOW_UPS = "Follow-ups:";
const MAX_FOLLOW_UPS = 3;

// The answer without its follow-ups line, and the questions it suggests.
// A last line still streaming in ("Follow-u") is held back too.
//   "Keys are sealed…\nFollow-ups: Who rotates them? | Where is the secret?"
//   → { body: "Keys are sealed…", followUps: ["Who rotates them?", "Where is the secret?"] }
export function splitFollowUps(text: string): { body: string; followUps: string[] } {
  const cut = text.trimEnd().lastIndexOf("\n");
  const last = text.slice(cut + 1).trim();
  const partial = last.length > 0 && FOLLOW_UPS.startsWith(last);
  if (!last.startsWith(FOLLOW_UPS) && !partial) {
    return { body: text, followUps: [] };
  }

  const followUps = partial
    ? []
    : last
        .slice(FOLLOW_UPS.length)
        .split("|")
        .map((q) => q.trim().replace(/^`|`$/g, ""))
        .filter(Boolean)
        .slice(0, MAX_FOLLOW_UPS);
  return { body: cut < 0 ? "" : text.slice(0, cut).trimEnd(), followUps };
}

// e.g. "src/pay.ts:42", `src/pay.ts:42-50`. A "/" or a known extension
// tells a path from host:port.
const CITED = /(?:^|[\s(`[])((?:[\w.-]+\/)*[\w.-]+\.\w{1,8}):(\d+)/g;

export type CitedFile = { path: string; line: number };

// Files an answer cites, in order of first mention, each at its first line.
export function citedFiles(text: string): CitedFile[] {
  const seen = new Map<string, number>();
  for (const m of text.matchAll(CITED)) {
    if (!seen.has(m[1]) && (m[1].includes("/") || !/^\d/.test(m[1]))) {
      seen.set(m[1], Number(m[2]));
    }
  }

  return [...seen].map(([path, line]) => ({ path, line }));
}
