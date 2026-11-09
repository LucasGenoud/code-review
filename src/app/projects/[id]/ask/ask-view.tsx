"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { UIMessage } from "ai";
import { History, Layers, Loader2, MessageSquare, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatPanel, type ChatState } from "@/components/chat/chat-panel";
import { ConfirmButton } from "@/components/projects/confirm-button";
import { formatCost } from "@/components/projects/review-status";
import type { ChatMetadata, TokenUsage } from "@/lib/chat";
import {
  compactCodebaseThread,
  deleteCodebaseThread,
  loadCodebaseThread,
  renameCodebaseThread,
  startCodebaseThread,
  type ChatModelInfo,
  type ThreadSummary,
} from "@/app/actions";
import { FileSheet, type FileRef } from "./file-sheet";

// Ask the codebase, full page:
//
//   ┌ history ─────────┬ title · model ───────────────────────────┐
//   │ [+ New chat]     │                                           │
//   │ Today            │   conversation (centered column)          │
//   │  How are errors… │                                           │
//   │ Previous 7 days  │   [ composer                          ]   │
//   │  …               │   hints     context 12k/200k · 48k · Compact│
//   └──────────────────┴───────────────────────────────────────────┘
//
// A new conversation gets its thread on the first question; the URL then
// becomes ?thread=<id> (replaceState: no server round trip, no remount).

const STARTERS = [
  "Give me a tour of this codebase",
  "Draw a diagram of how a request flows through the app",
  "Which parts look fragile or untested?",
  "How are errors handled?",
];

const THOUSAND = 1_000;
const MILLION = 1_000_000;
const PER_MILLION = 1_000_000;
// Context share where the meter turns amber (suggest compacting) and red,
// and where sending a question compacts the conversation first.
const CONTEXT_WARN = 0.7;
const AUTO_COMPACT = 0.8;
const CONTEXT_FULL = 0.9;
const PERCENT = 100;
const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;
const MIN_COMPACT_MESSAGES = 2;

// The conversation on screen. `key` remounts the chat when switching.
type Active = { key: string; threadId: number | null; messages: UIMessage[] };

type Props = {
  project: { id: number; name: string };
  model: ChatModelInfo;
  initialThreads: ThreadSummary[];
  initialThreadId: number | null;
  initialMessages: UIMessage[];
};

let newChats = 0;

export function AskView({ project, model, initialThreads, initialThreadId, initialMessages }: Props) {
  const [threads, setThreads] = useState(initialThreads);
  const [active, setActive] = useState<Active>(() => ({
    key: threadKey(initialThreadId),
    threadId: initialThreadId,
    messages: initialMessages,
  }));
  const [opening, setOpening] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewing, setViewing] = useState<FileRef | null>(null);
  // Read by the chat's request body, which outlives renders.
  const threadIdRef = useRef(initialThreadId);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const base = `/projects/${project.id}/ask`;

  function show(threadId: number | null, messages: UIMessage[]) {
    threadIdRef.current = threadId;
    setActive({ key: threadKey(threadId), threadId, messages });
    window.history.replaceState(null, "", threadId === null ? base : `${base}?thread=${threadId}`);
    setHistoryOpen(false);
    inputRef.current?.focus();
  }

  async function open(threadId: number) {
    if (threadId === active.threadId) {
      setHistoryOpen(false);
      return;
    }

    setOpening(threadId);
    try {
      show(threadId, await loadCodebaseThread(project.id, threadId));
    } catch {
      toast.error("Couldn't open the conversation");
    } finally {
      setOpening(null);
    }
  }

  // First question of a new conversation: create its thread first. A full
  // context window: compact before asking.
  async function beforeSend(question: string, chat: ChatState): Promise<boolean> {
    if (threadIdRef.current !== null) {
      return compactIfFull(threadIdRef.current, chat);
    }

    const result = await startCodebaseThread(project.id, question);
    if (result.error !== undefined) {
      toast.error(result.error);
      return false;
    }

    const thread = result.data;
    threadIdRef.current = thread.id;
    setActive((a) => ({ ...a, threadId: thread.id }));
    setThreads((all) => [thread, ...all]);
    window.history.replaceState(null, "", `${base}?thread=${thread.id}`);
    return true;
  }

  async function compactIfFull(threadId: number, chat: ChatState): Promise<boolean> {
    if (contextTokens(chat.messages) < model.contextWindow * AUTO_COMPACT) {
      return true;
    }

    const toastId = toast.loading("Context window almost full: compacting the conversation…");
    const result = await compactCodebaseThread(project.id, threadId);
    if (result.error !== undefined) {
      toast.error(`Couldn't compact: ${result.error}`, { id: toastId });
      return true;
    }

    chat.replace(result.data);
    toast.success("Conversation compacted to fit the context window", { id: toastId });
    return true;
  }

  // Moves the answered conversation to the top of the history.
  function onAnswered() {
    const id = threadIdRef.current;
    setThreads((all) => {
      const thread = all.find((t) => t.id === id);
      return thread ? [{ ...thread, updatedAt: new Date() }, ...all.filter((t) => t !== thread)] : all;
    });
  }

  async function remove(threadId: number) {
    const result = await deleteCodebaseThread(project.id, threadId);
    if (result.error) {
      return result;
    }

    setThreads((all) => all.filter((t) => t.id !== threadId));
    if (threadId === active.threadId) {
      show(null, []);
    }
  }

  async function rename(threadId: number, title: string) {
    const result = await renameCodebaseThread(project.id, threadId, title);
    if (result.error) {
      toast.error(result.error);
      return;
    }

    setThreads((all) => all.map((t) => (t.id === threadId ? { ...t, title: title.trim() } : t)));
  }

  const title = threads.find((t) => t.id === active.threadId)?.title ?? "New conversation";
  const history = (
    <ThreadList
      threads={threads}
      activeId={active.threadId}
      opening={opening}
      onOpen={(id) => void open(id)}
      onRename={(id, t) => void rename(id, t)}
      onDelete={remove}
    />
  );

  return (
    <>
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-card md:flex" aria-label="Conversation history">
        <div className="flex flex-col gap-2 border-b p-3">
          <Link href={`/projects/${project.id}`} className="truncate text-xs text-muted-foreground hover:text-foreground">
            ← {project.name}
          </Link>
          <Button onClick={() => show(null, [])} className="w-full justify-start">
            <Plus />
            New chat
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">{history}</div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b px-4 py-2.5">
          <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="History" onClick={() => setHistoryOpen(true)}>
            <History />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            <p className="truncate text-xs text-muted-foreground">
              Ask the codebase · {model.label} · reads the working tree, never changes files
            </p>
          </div>
          <Button variant="outline" size="sm" className="md:hidden" onClick={() => show(null, [])}>
            <Plus />
            New
          </Button>
        </header>

        <ChatPanel
          key={active.key}
          id={`ask-${active.key}`}
          api={`/api/projects/${project.id}/chat`}
          body={() => ({ threadId: threadIdRef.current })}
          inputRef={inputRef}
          starters={STARTERS}
          placeholder="Ask about the code, e.g. Where are API keys stored?"
          initialMessages={active.messages}
          resume={active.threadId !== null}
          beforeSend={beforeSend}
          onAnswered={onAnswered}
          onOpenFile={(path, line) => setViewing({ path, line })}
          columnClassName="mx-auto w-full max-w-3xl"
          footer={(chat) => <TokenMeter chat={chat} model={model} projectId={project.id} threadId={active.threadId} />}
        />
      </section>

      <FileSheet projectId={project.id} file={viewing} onClose={() => setViewing(null)} />

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="w-72 gap-0 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>History</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">{history}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// "t12", or a fresh "new3" so each new conversation gets its own chat state.
function threadKey(threadId: number | null): string {
  return threadId === null ? `new${++newChats}` : `t${threadId}`;
}

type ListProps = {
  threads: ThreadSummary[];
  activeId: number | null;
  // Thread being loaded.
  opening: number | null;
  onOpen: (id: number) => void;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => Promise<{ error?: string } | void>;
};

function ThreadList({ threads, activeId, opening, onOpen, onRename, onDelete }: ListProps) {
  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-xs text-muted-foreground">
        <MessageSquare className="size-5" aria-hidden />
        Your conversations show up here.
      </div>
    );
  }

  return (
    <nav className="flex flex-col gap-3">
      {groupByAge(threads).map(([label, group]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <p className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">{label}</p>
          {group.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              active={t.id === activeId}
              opening={t.id === opening}
              onOpen={() => onOpen(t.id)}
              onRename={(title) => onRename(t.id, title)}
              onDelete={() => onDelete(t.id)}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

type RowProps = {
  thread: ThreadSummary;
  active: boolean;
  opening: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => Promise<{ error?: string } | void>;
};

function ThreadRow({ thread, active, opening, onOpen, onRename, onDelete }: RowProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const title = new FormData(e.currentTarget).get("title");
          if (typeof title === "string" && title.trim() && title.trim() !== thread.title) {
            onRename(title);
          }

          setEditing(false);
        }}
      >
        <Input
          name="title"
          defaultValue={thread.title}
          aria-label="Conversation title"
          className="h-8 text-sm"
          autoFocus
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setEditing(false);
            }
          }}
        />
      </form>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md pr-1 transition-colors hover:bg-muted",
        active && "bg-muted font-medium",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "page" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {opening && <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />}
        <span className="truncate">{thread.title || "Untitled"}</span>
      </button>
      <div className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
        <Button variant="ghost" size="icon-xs" aria-label={`Rename "${thread.title}"`} onClick={() => setEditing(true)}>
          <Pencil />
        </Button>
        <ConfirmButton
          label={`Delete "${thread.title}"`}
          title="Delete this conversation?"
          description={thread.title}
          onConfirm={onDelete}
        />
      </div>
    </div>
  );
}

// [["Today", […]], ["Previous 7 days", […]], …] in the threads' order.
function groupByAge(threads: ThreadSummary[]): [string, ThreadSummary[]][] {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const groups = new Map<string, ThreadSummary[]>();

  for (const t of threads) {
    const label = ageLabel(new Date(t.updatedAt).getTime(), startOfToday);
    groups.set(label, [...(groups.get(label) ?? []), t]);
  }

  return [...groups];
}

function ageLabel(time: number, startOfToday: number): string {
  if (time >= startOfToday) {
    return "Today";
  }

  if (time >= startOfToday - DAY_MS) {
    return "Yesterday";
  }

  return time >= startOfToday - WEEK_DAYS * DAY_MS ? "Previous 7 days" : "Older";
}

type MeterProps = { chat: ChatState; model: ChatModelInfo; projectId: number; threadId: number | null };

// Context fill (what the next turn sends), tokens spent so far, cost, and
// the compact button, suggested once the context gets full.
function TokenMeter({ chat, model, projectId, threadId }: MeterProps) {
  const [compacting, setCompacting] = useState(false);
  const metas = chat.messages.map((m) => m.metadata as ChatMetadata | undefined);
  const used = metas.reduce<TokenUsage>(
    (sum, m) => ({ input: sum.input + (m?.usage?.input ?? 0), output: sum.output + (m?.usage?.output ?? 0) }),
    { input: 0, output: 0 },
  );
  const context = contextTokens(chat.messages);
  const share = Math.min(context / model.contextWindow, 1);
  const cost =
    model.inputCost === null || model.outputCost === null
      ? null
      : (used.input * model.inputCost + used.output * model.outputCost) / PER_MILLION;
  const canCompact = threadId !== null && !chat.busy && chat.messages.length >= MIN_COMPACT_MESSAGES;

  async function compact() {
    if (threadId === null) {
      return;
    }

    setCompacting(true);
    const result = await compactCodebaseThread(projectId, threadId);
    setCompacting(false);
    if (result.error !== undefined) {
      toast.error(result.error);
      return;
    }

    chat.replace(result.data);
    toast.success("Conversation compacted");
  }

  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
      <Tooltip>
        <TooltipTrigger render={<span className="flex cursor-default items-center gap-1.5" />}>
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span
              className={cn(
                "block h-full rounded-full bg-primary/60",
                share >= CONTEXT_WARN && "bg-amber-500",
                share >= CONTEXT_FULL && "bg-red-500",
              )}
              style={{ width: `${share * PERCENT}%` }}
            />
          </span>
          {formatTokens(context)} / {formatTokens(model.contextWindow)}
        </TooltipTrigger>
        <TooltipContent>
          Context: {Math.round(share * PERCENT)}% of the window is sent with your next question.
        </TooltipContent>
      </Tooltip>

      <span title="Tokens spent in this conversation">
        {formatTokens(used.input)} in · {formatTokens(used.output)} out
        {cost !== null && ` · ${formatCost(cost)}`}
      </span>

      <Button
        type="button"
        size="xs"
        variant={share >= CONTEXT_WARN ? "secondary" : "ghost"}
        disabled={!canCompact || compacting}
        onClick={() => void compact()}
        title="Replace the conversation with a summary to free the context window"
      >
        {compacting ? <Loader2 className="animate-spin" /> : <Layers />}
        Compact
      </Button>
    </div>
  );
}

// What the next turn sends: the latest answer's (or summary's) context size.
function contextTokens(messages: UIMessage[]): number {
  const metas = messages.map((m) => m.metadata as ChatMetadata | undefined);
  return metas.findLast((m) => m?.context !== undefined)?.context ?? 0;
}

// 950 → "950", 12_400 → "12.4k", 200_000 → "200k", 1_000_000 → "1M".
function formatTokens(n: number): string {
  if (n < THOUSAND) {
    return String(n);
  }

  if (n < MILLION) {
    return `${Number((n / THOUSAND).toFixed(n < 10 * THOUSAND ? 1 : 0))}k`;
  }

  return `${Number((n / MILLION).toFixed(1))}M`;
}
