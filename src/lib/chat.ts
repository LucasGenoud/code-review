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

// Attached to assistant messages.
export type ChatMetadata = {
  // Tokens this answer cost.
  usage?: TokenUsage;
  // Tokens the model sees on the next turn, e.g. 12_400 of a 200k window.
  context?: number;
  stop?: ChatStop;
};

