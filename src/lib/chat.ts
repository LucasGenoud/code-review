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
