import { ChatMode } from "@/lib/chat";

// Questions about this repository at PINNED_SHA, each with the files a good
// answer cites. Covers lookups ("where"), mechanisms spanning several files
// ("how"), root causes, plans and a diagram, so a change to retrieval,
// tools or prompts shows up as recall, tool calls and tokens.

// This app's own code, so the eval needs no download.
export const PINNED_SHA = "4878eb3f2a8752ed47f433d011d4979e31622bf3";

export type AskCase = {
  name: string;
  mode: ChatMode;
  question: string;
  // Repository paths the answer should cite.
  files: string[];
};

export const ASK_CASES: AskCase[] = [
  {
    name: "01-api-keys",
    mode: ChatMode.Ask,
    question: "How are provider API keys stored at rest?",
    files: ["src/server/drivers/crypto.ts", "src/server/services/providers.ts"],
  },
  {
    name: "02-reload-stream",
    mode: ChatMode.Ask,
    question: "What happens to an answer that is still being generated when I reload the page?",
    files: ["src/server/drivers/liveStreams.ts", "src/server/services/chat.ts"],
  },
  {
    name: "03-context-window",
    mode: ChatMode.Ask,
    question: "How does the chat keep long conversations within the model's context window?",
    files: ["src/server/services/chatContext.ts", "src/server/services/chat.ts", "src/server/drivers/llm.ts"],
  },
  {
    name: "04-quote-anchor",
    mode: ChatMode.Ask,
    question: "Models get line numbers wrong. How does a finding's quoted code get mapped back to the right lines?",
    files: ["src/server/services/review/locate.ts"],
  },
  {
    name: "05-repo-root",
    mode: ChatMode.Ask,
    question: "How are projects restricted to folders under REPO_ROOT, including symlinks pointing outside?",
    files: ["src/server/services/paths.ts", "src/server/drivers/fs.ts"],
  },
  {
    name: "06-concurrency",
    mode: ChatMode.Ask,
    question: "How does the review engine cap concurrent LLM requests per model?",
    files: ["src/server/services/review/limiter.ts", "src/server/services/review/engine.ts"],
  },
  {
    name: "07-rule-changes",
    mode: ChatMode.Ask,
    question: "How are dismissed findings turned into proposed rule changes?",
    files: ["src/server/services/ruleChanges.ts"],
  },
  {
    name: "08-git-config",
    mode: ChatMode.Ask,
    question: "Why does every git command run with core.autocrlf=input and core.checkStat=minimal?",
    files: ["src/server/drivers/git.ts"],
  },
  {
    name: "09-sandbox",
    mode: ChatMode.Ask,
    question: "How does run_code execute code, and what isolation does it have?",
    files: ["src/server/services/sandbox.ts", "src/server/drivers/sandbox.ts", "sandbox/runner.mjs"],
  },
  {
    name: "10-diff-parse",
    mode: ChatMode.Ask,
    question: "How is a unified diff parsed into files and hunks?",
    files: ["src/server/services/diffParse.ts"],
  },
  {
    name: "11-declaration-end",
    mode: ChatMode.Ask,
    question: "How does read_symbol know where a function's declaration ends?",
    files: ["src/server/services/symbols.ts", "src/server/services/repoTools.ts"],
  },
  {
    name: "12-migrations",
    mode: ChatMode.Ask,
    question: "Where and when are database migrations applied?",
    files: ["src/server/drivers/db.ts"],
  },
  {
    name: "13-fix-head",
    mode: ChatMode.Debug,
    question: "Applying a fix fails with \"Check out the reviewed head\". Why, and how do I get past it?",
    files: ["src/server/services/reviews.ts"],
  },
  {
    name: "14-crlf-docker",
    mode: ChatMode.Debug,
    question: "With Docker on Windows, a working-tree review showed every file as changed. What in the code prevents that now?",
    files: ["src/server/drivers/git.ts"],
  },
  {
    name: "15-copy-finding",
    mode: ChatMode.Plan,
    question: "Add a button to copy a single finding as markdown.",
    files: ["src/components/report/finding-card.tsx"],
  },
  {
    name: "16-new-mode",
    mode: ChatMode.Plan,
    question: "Add a chat mode called Explain that teaches the code to a newcomer.",
    files: ["src/lib/chat.ts", "src/server/services/chatPrompts.ts"],
  },
  {
    name: "17-stream-readers",
    mode: ChatMode.Hunt,
    question: "Look for bugs in how live chat streams handle readers that disconnect or reconnect.",
    files: ["src/server/drivers/liveStreams.ts"],
  },
  {
    name: "18-review-diagram",
    mode: ChatMode.Ask,
    question: "Draw a diagram of what happens when a review starts, from the button to saved findings.",
    files: ["src/app/actions.ts", "src/server/services/review/engine.ts"],
  },
  {
    name: "19-rules-transfer",
    mode: ChatMode.Ask,
    question: "How are rules exported to a file and imported back?",
    files: ["src/app/api/rules/export/route.ts", "src/server/services/rules.ts"],
  },
  {
    name: "20-stats",
    mode: ChatMode.Ask,
    question: "How does the stats page compute token usage and cost per day?",
    files: ["src/server/services/stats.ts", "src/server/drivers/statsStore.ts"],
  },
];
