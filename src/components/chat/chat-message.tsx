"use client";

import { Fragment } from "react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { ChevronRight, FlaskConical, Loader2, Wrench } from "lucide-react";
import { cn } from "cn";

// One chat message: user bubble or assistant text with light formatting,
// tool calls as chips, sandbox runs as cards.

type ToolPart = Extract<UIMessage["parts"][number], { toolCallId: string }>;

const RUN_CODE = "run_code";

// Fenced code blocks, kept as separate segments when splitting.
// e.g. "a ```py\nx\n``` b" → ["a ", "```py\nx\n```", " b"]. Unclosed fences
// (while streaming) run to the end.
const FENCE = /(```[\s\S]*?(?:```|$))/;
const FENCE_BODY = /^```[\w+-]*\n?([\s\S]*?)(?:```)?$/;
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|#\d+\b)/;
const FINDING_REF = /^#(\d+)$/;

type Props = {
  message: UIMessage;
  // Finding ids that can be jumped to from "#12" references.
  findingIds: Set<number>;
  onCite: (id: number) => void;
};

export function ChatMessage({ message, findingIds, onCite }: Props) {
  if (message.role === "user") {
    return (
      <div className="ml-10 rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
        {message.parts.map((p, i) => (p.type === "text" ? <Fragment key={i}>{p.text}</Fragment> : null))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed">
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          return <RichText key={i} text={part.text} findingIds={findingIds} onCite={onCite} />;
        }

        if (isToolUIPart(part)) {
          return getToolName(part) === RUN_CODE ? <RunCodeCard key={i} part={part} /> : <ToolChip key={i} part={part} />;
        }

        return null;
      })}
    </div>
  );
}

function RichText({ text, findingIds, onCite }: { text: string } & Omit<Props, "message">) {
  return (
    <div className="flex flex-col gap-2">
      {text.split(FENCE).map((segment, i) => {
        if (segment.startsWith("```")) {
          return (
            <pre key={i} className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed">
              {FENCE_BODY.exec(segment)?.[1] ?? segment}
            </pre>
          );
        }

        if (!segment.trim()) {
          return null;
        }

        return (
          <p key={i} className="whitespace-pre-wrap">
            <Inline text={segment.trim()} findingIds={findingIds} onCite={onCite} />
          </p>
        );
      })}
    </div>
  );
}

// Inline `code`, **bold** and #12 finding references.
function Inline({ text, findingIds, onCite }: { text: string } & Omit<Props, "message">) {
  return text.split(INLINE).map((token, i) => {
    if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>
      );
    }

    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      return <strong key={i}>{token.slice(2, -2)}</strong>;
    }

    const ref = FINDING_REF.exec(token);
    if (ref && findingIds.has(Number(ref[1]))) {
      return (
        <button
          key={i}
          type="button"
          onClick={() => onCite(Number(ref[1]))}
          className="rounded font-mono text-[0.9em] text-blue-700 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 dark:text-blue-400"
        >
          {token}
        </button>
      );
    }

    return <Fragment key={i}>{token}</Fragment>;
  });
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
