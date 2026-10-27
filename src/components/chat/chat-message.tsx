"use client";

import { Fragment } from "react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { Brain, ChevronRight, FlaskConical, Layers, Loader2, Wrench } from "lucide-react";
import { cn } from "cn";
import { SUMMARY_PREFIX, type ChatMetadata } from "@/lib/chat";
import { CopyButton, Markdown, type CiteProps } from "./markdown";

// One chat message: user bubble or assistant markdown,
// the model's thinking, tool calls as chips, sandbox runs as cards, code
// blocks and answers with a copy button, a compacted conversation's summary.

type ToolPart = Extract<UIMessage["parts"][number], { toolCallId: string }>;
type ReasoningPart = Extract<UIMessage["parts"][number], { type: "reasoning" }>;

const RUN_CODE = "run_code";

type Props = { message: UIMessage } & CiteProps;

export function ChatMessage({ message, ...cite }: Props) {
  if ((message.metadata as ChatMetadata | undefined)?.summary) {
    return <SummaryCard message={message} {...cite} />;
  }

  if (message.role === "user") {
    return (
      <div className="ml-10 rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
        {message.parts.map((p, i) => (p.type === "text" ? <Fragment key={i}>{p.text}</Fragment> : null))}
      </div>
    );
  }

  const answer = messageText(message);

  return (
    <div className="group/answer flex flex-col gap-2 text-sm leading-relaxed">
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          return <Markdown key={i} text={part.text} {...cite} />;
        }

        if (part.type === "reasoning") {
          return <Reasoning key={i} part={part} />;
        }

        if (isToolUIPart(part)) {
          return getToolName(part) === RUN_CODE ? <RunCodeCard key={i} part={part} /> : <ToolChip key={i} part={part} />;
        }

        return null;
      })}
      {answer && (
        <CopyButton
          text={answer}
          label="Copy answer"
          className="self-start opacity-0 transition-opacity group-hover/answer:opacity-100 focus-visible:opacity-100"
        />
      )}
    </div>
  );
}

// The text a compacted conversation was replaced with, collapsed.
function SummaryCard({ message, ...cite }: Props) {
  const text = messageText(message).replace(SUMMARY_PREFIX, "");

  return (
    <details className="group rounded-lg border border-dashed bg-muted/30 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        <Layers className="size-4" aria-hidden />
        <span className="flex-1">Earlier conversation compacted into a summary</span>
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
      </summary>
      <div className="border-t px-3 py-2 leading-relaxed">
        <Markdown text={text} {...cite} />
      </div>
    </details>
  );
}

function messageText(message: UIMessage): string {
  return message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

// Model's thinking: open while it streams, collapsed once done.
function Reasoning({ part }: { part: ReasoningPart }) {
  const streaming = part.state === "streaming";
  if (!part.text.trim() && !streaming) {
    return null;
  }

  return (
    <details open={streaming} className="group text-xs">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        {streaming ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Brain className="size-3" aria-hidden />}
        {streaming ? "Thinking…" : "Thought process"}
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" aria-hidden />
      </summary>
      <p className="mt-1 max-h-60 overflow-y-auto border-l-2 pl-2.5 leading-relaxed whitespace-pre-wrap text-muted-foreground">{part.text}</p>
    </details>
  );
}

// "read_file shop/app.py", expandable to the tool output.
function ToolChip({ part }: { part: ToolPart }) {
  const done = part.state === "output-available" || part.state === "output-error";

  return (
    <details className="group text-xs">
      <summary className="inline-flex max-w-full cursor-pointer list-none items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        {done ? <Wrench className="size-3" aria-hidden /> : <Loader2 className="size-3 animate-spin" aria-hidden />}
        <span className="font-mono">{getToolName(part)}</span>
        <span className="truncate font-mono opacity-70">{inputSummary(part.input)}</span>
        {done && <ChevronRight className="size-3 transition-transform group-open:rotate-90" aria-hidden />}
      </summary>
      {done && (
        <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-muted px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
          {part.state === "output-error" ? part.errorText : String(part.output ?? "")}
        </pre>
      )}
    </details>
  );
}

// First string argument, e.g. { path: "app.py" } → "app.py".
function inputSummary(input: unknown): string {
  if (!input || typeof input !== "object") {
    return "";
  }

  return Object.values(input).find((v): v is string => typeof v === "string") ?? "";
}

enum RunOutcome {
  Running = "running",
  Passed = "passed",
  Failed = "failed",
  TimedOut = "timed_out",
}

const OUTCOME_CLASSES: Record<RunOutcome, string> = {
  [RunOutcome.Running]: "bg-muted text-muted-foreground",
  [RunOutcome.Passed]: "bg-green-500/10 text-green-700 dark:text-green-300",
  [RunOutcome.Failed]: "bg-red-500/10 text-red-700 dark:text-red-300",
  [RunOutcome.TimedOut]: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
};

const EXIT_LINE = /^Exit code (-?\d+)/;
const TIMEOUT_LINE = /^Timed out/;

// Sandbox run: language, collapsible code, output with the exit status.
function RunCodeCard({ part }: { part: ToolPart }) {
  const input = (part.input ?? {}) as { language?: string; code?: string };
  const output = part.state === "output-error" ? (part.errorText ?? "") : String(part.output ?? "");
  const [status, ...rest] = output.split("\n");
  const outcome = runOutcome(part, status);

  return (
    <div className="overflow-hidden rounded-md border text-xs">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-2.5 py-1.5">
        <FlaskConical className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium">Sandbox run</span>
        {input.language && <span className="rounded bg-muted px-1.5 font-mono text-[11px]">{input.language}</span>}
        <span className={cn("ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", OUTCOME_CLASSES[outcome])}>
          {outcome === RunOutcome.Running && <Loader2 className="size-3 animate-spin" aria-hidden />}
          {outcome === RunOutcome.Running ? "Running…" : status}
        </span>
      </div>

      {input.code && (
        <details className="group border-b">
          <summary className="flex cursor-pointer list-none items-center gap-1 px-2.5 py-1 text-muted-foreground outline-none hover:text-foreground focus-visible:bg-muted">
            <ChevronRight className="size-3 transition-transform group-open:rotate-90" aria-hidden />
            Code · {input.code.split("\n").length} lines
          </summary>
          <pre className="max-h-72 overflow-auto bg-muted/30 px-2.5 py-2 font-mono text-[11px] leading-relaxed">{input.code}</pre>
        </details>
      )}

      {outcome !== RunOutcome.Running && rest.join("\n").trim() && (
        <pre className="max-h-72 overflow-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
          {rest.join("\n").trim()}
        </pre>
      )}
    </div>
  );
}

function runOutcome(part: ToolPart, status: string): RunOutcome {
  if (part.state === "output-error") {
    return RunOutcome.Failed;
  }

  if (part.state !== "output-available") {
    return RunOutcome.Running;
  }

  if (TIMEOUT_LINE.test(status)) {
    return RunOutcome.TimedOut;
  }

  return EXIT_LINE.exec(status)?.[1] === "0" ? RunOutcome.Passed : RunOutcome.Failed;
}
