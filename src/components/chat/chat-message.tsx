"use client";

import { Fragment } from "react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { BookmarkPlus, Brain, ChevronRight, FileCode, FlaskConical, Layers, Loader2, Telescope, Wrench } from "lucide-react";
import { cn } from "cn";
import { citedFiles, splitFollowUps, SUMMARY_PREFIX, type ChatMetadata } from "@/lib/chat";
import { CopyButton, Markdown, type CiteProps } from "./markdown";

// One chat message: user bubble or assistant markdown,
// the model's thinking, tool calls as chips, sandbox runs and explorer
// reports as cards, code blocks and answers with a copy button, the files
// an answer cites, its follow-up questions, a compacted conversation's
// summary.
//
//   answer markdown …
//   Sources  [pay.ts:42] [db.ts:7]
//   [Who rotates keys?] [Where is the secret?]     ← last answer only
//   Copy · Save to memory

type ToolPart = Extract<UIMessage["parts"][number], { toolCallId: string }>;
type ReasoningPart = Extract<UIMessage["parts"][number], { type: "reasoning" }>;

const RUN_CODE = "run_code";
const EXPLORE = "explore";
const MAX_SOURCES = 8;

// onSave: offers "Save to memory" on answers; absent = not offered.
// onFollowUp: shows the answer's follow-up questions as buttons; absent = hidden.
type Props = { message: UIMessage; onSave?: (answer: string) => void; onFollowUp?: (question: string) => void } & CiteProps;

export function ChatMessage({ message, onSave, onFollowUp, ...cite }: Props) {
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

  // The follow-ups line ends the last text part.
  const lastText = message.parts.findLastIndex((p) => p.type === "text");
  const { followUps } = lastText < 0 ? { followUps: [] } : splitFollowUps((message.parts[lastText] as { text: string }).text);
  const answer = splitFollowUps(messageText(message)).body;
  const sources = cite.onOpenFile ? citedFiles(answer) : [];

  return (
    <div className="group/answer flex flex-col gap-2 text-sm leading-relaxed">
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          return <Markdown key={i} text={i === lastText ? splitFollowUps(part.text).body : part.text} {...cite} />;
        }

        if (part.type === "reasoning") {
          return <Reasoning key={i} part={part} />;
        }

        if (!isToolUIPart(part)) {
          return null;
        }

        if (getToolName(part) === RUN_CODE) {
          return <RunCodeCard key={i} part={part} />;
        }

        return getToolName(part) === EXPLORE ? <ExploreCard key={i} part={part} {...cite} /> : <ToolChip key={i} part={part} />;
      })}
      {sources.length > 0 && cite.onOpenFile && <Sources files={sources} onOpen={cite.onOpenFile} />}
      {onFollowUp && followUps.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Follow-up questions">
          {followUps.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onFollowUp(q)}
              className="rounded-full border bg-background px-3 py-1 text-left text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {q}
            </button>
          ))}
        </div>
      )}
      {answer && (
        <div className="flex gap-1 self-start opacity-0 transition-opacity group-hover/answer:opacity-100 focus-within:opacity-100">
          <CopyButton text={answer} label="Copy answer" />
          {onSave && (
            <button
              type="button"
              onClick={() => onSave(answer)}
              title="Save to project memory: later chats start from it"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <BookmarkPlus className="size-3" aria-hidden />
              Save to memory
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// The files an answer cites, as buttons opening each at its first cited line.
function Sources({ files, onOpen }: { files: { path: string; line: number }[]; onOpen: (path: string, line: number) => void }) {
  const shown = files.slice(0, MAX_SOURCES);

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Sources">
      <span className="text-muted-foreground">Sources</span>
      {shown.map((f) => (
        <button
          key={f.path}
          type="button"
          onClick={() => onOpen(f.path, f.line)}
          title={`${f.path}:${f.line}`}
          className="inline-flex max-w-56 items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <FileCode className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{f.path.split("/").at(-1)}:{f.line}</span>
        </button>
      ))}
      {files.length > shown.length && <span className="text-muted-foreground">+{files.length - shown.length}</span>}
    </div>
  );
}

// An explorer sub-agent: its assignment, then its report as markdown with
// clickable citations. Collapsed once done: the answer builds on it.
function ExploreCard({ part, ...cite }: { part: ToolPart } & CiteProps) {
  const done = part.state === "output-available" || part.state === "output-error";
  const assignment = (part.input as { assignment?: string } | undefined)?.assignment ?? "";

  return (
    <details className="group rounded-lg border bg-card text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        {done ? <Telescope className="size-3.5 shrink-0" aria-hidden /> : <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />}
        <span className="shrink-0 font-medium">{done ? "Explorer" : "Exploring"}</span>
        <span className="truncate">{assignment}</span>
        {done && <ChevronRight className="ml-auto size-3 shrink-0 transition-transform group-open:rotate-90" aria-hidden />}
      </summary>
      {done && (
        <div className="border-t px-3 py-2 leading-relaxed">
          {part.state === "output-error" ? <p className="text-red-700 dark:text-red-300">{part.errorText}</p> : <Markdown text={String(part.output ?? "")} {...cite} />}
        </div>
      )}
    </details>
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

// First string or list argument, e.g. { path: "app.py" } → "app.py",
// { names: ["pay", "refund"] } → "pay, refund".
function inputSummary(input: unknown): string {
  if (!input || typeof input !== "object") {
    return "";
  }

  const value = Object.values(input).find((v) => typeof v === "string" || Array.isArray(v));
  return Array.isArray(value) ? value.join(", ") : (value ?? "");
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
