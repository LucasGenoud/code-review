"use client";

import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowDown, ArrowUp, CornerDownRight, ListPlus, RotateCcw, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CHAT_MODES, ChatMode, ChatStop, type ChatMetadata } from "@/lib/chat";
import { ChatMessage } from "./chat-message";

// A conversation and its composer, without chrome. Used in the review
// chat sheet and on the Ask the codebase page.
//
//   ┌ messages (scrolls, sticks to the bottom while streaming) ┐
//   │ stop notice: "hit the output limit" [Continue]            │
//   │                    [↓ Latest] (when scrolled up)          │
//   ├ queue: messages sent while answering, sent in order  [×] ─┤
//   ├ composer ─────────────────────────────────────────────────┤
//   │ [Ask|Debug|Find bugs|Plan]             footer (e.g. meter)│
//   └───────────────────────────────────────────────────────────┘
//
// Sending while an answer streams queues the message; each queued message
// goes out when the previous answer ends. An error pauses the queue.

const NO_FINDINGS = new Set<number>();
// Within this many pixels of the bottom counts as at the bottom. Small, so a
// short scroll up while streaming isn't undone by the next token.
const STICK_DISTANCE_PX = 8;
const CONTINUE_PROMPT = "Continue where you stopped.";
const MODES = Object.values(ChatMode);

type Queued = { id: number; text: string; mode: ChatMode };

// Lets the parent prefill or send a message, e.g. from a finding's "Ask".
export type ChatHandle = {
  prefill: (text: string) => void;
  send: (text: string) => void;
};

// What a footer can read and do.
export type ChatState = {
  messages: UIMessage[];
  busy: boolean;
  // Swaps the whole conversation, e.g. for its compacted summary.
  replace: (messages: UIMessage[]) => void;
};

type Props = {
  ref?: React.Ref<ChatHandle>;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  // useChat id: a different id is a different conversation.
  id: string;
  // useChat endpoint, e.g. /api/reviews/3/chat.
  api: string;
  // Extra request body, read on each send, e.g. { threadId: 3 }. Only the
  // first one is used: read changing values from a ref.
  body?: () => object;
  starters: string[];
  placeholder: string;
  initialMessages: UIMessage[];
  // Reconnects on mount to an answer still being generated (after a reload).
  resume?: boolean;
  // Runs before a message goes out, e.g. to create its thread or compact
  // the conversation. false cancels.
  beforeSend?: (text: string, chat: ChatState) => Promise<boolean>;
  onAnswered?: () => void;
  // Right side of the composer's bottom line, e.g. the token meter.
  footer?: (chat: ChatState) => React.ReactNode;
  // Conversation column, e.g. "mx-auto max-w-3xl".
  columnClassName?: string;
  // Findings that "#12" in answers can jump to.
  findingIds?: Set<number>;
  onCite?: (id: number) => void;
  // Opens a file cited as path:line.
  onOpenFile?: (path: string, line: number) => void;
};

export function ChatPanel(props: Props) {
  const { ref, id, api, starters, placeholder, initialMessages, beforeSend, onAnswered, footer, columnClassName } = props;
  const { findingIds = NO_FINDINGS, onCite = () => {}, onOpenFile } = props;

  // GET (reconnect) and DELETE (stop) go to the same endpoint, with the
  // body as query, e.g. /api/projects/1/chat?threadId=3.
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api,
        body: props.body,
        prepareReconnectToStreamRequest: ({ body }) => ({ api: liveUrl(api, body ?? {}) }),
      }),
  );
  const { messages, sendMessage, setMessages, status, stop, error, regenerate } = useChat({
    id,
    messages: initialMessages,
    transport,
    resume: props.resume,
    onFinish: () => onAnswered?.(),
  });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState(ChatMode.Ask);
  const [queue, setQueue] = useState<Queued[]>([]);
  const queueId = useRef(0);
  const ownInputRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = props.inputRef ?? ownInputRef;
  const { scrollRef, contentRef, onScroll, pinned, follow, jumpToLatest } = useStickToBottom();
  const busy = sending || status === "submitted" || status === "streaming";

  // mode: the queued message's, else the selected one.
  async function send(text: string, as: ChatMode = mode) {
    if (!text.trim()) {
      return;
    }

    if (busy) {
      setQueue((q) => [...q, { id: ++queueId.current, text: text.trim(), mode: as }]);
      setDraft("");
      return;
    }

    setSending(true);
    try {
      if (beforeSend && !(await beforeSend(text.trim(), { messages, busy: false, replace: setMessages }))) {
        return;
      }

      follow();
      void sendMessage({ text: text.trim() }, { body: { mode: as } });
      setDraft((d) => (d.trim() === text.trim() ? "" : d));
    } finally {
      setSending(false);
    }
  }

  // Next queued message once the answer ended; errors wait for Retry.
  const sendNext = useEffectEvent(() => {
    const [next, ...rest] = queue;
    setQueue(rest);
    void send(next.text, next.mode);
  });

  useEffect(() => {
    if (busy || error || queue.length === 0) {
      return;
    }

    // After the commit that ended the answer, so useChat is ready again.
    const timer = setTimeout(sendNext, 0);
    return () => clearTimeout(timer);
  }, [busy, error, queue.length]);

  // Takes a queued message back into the composer to edit it.
  function unqueue(item: Queued) {
    setQueue((q) => q.filter((x) => x.id !== item.id));
    setDraft(item.text);
    setMode(item.mode);
    inputRef.current?.focus();
  }

  useImperativeHandle(ref, () => ({
    prefill: (text) => setDraft(text),
    send: (text) => void send(text),
  }));

  // Stops the download and the generation on the server.
  function stopAnswer() {
    void stop();
    void fetch(liveUrl(api, props.body?.() ?? {}), { method: "DELETE" });
  }

  const last = messages.at(-1);
  const stopped = !busy && last?.role === "assistant" ? (last.metadata as ChatMetadata | undefined)?.stop : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
          <div ref={contentRef} className={columnClassName}>
            {messages.length === 0 ? (
              <Starters starters={starters} onPick={(s) => void send(s)} />
            ) : (
              <div className="flex flex-col gap-5">
                {messages.map((m) => (
                  <ChatMessage key={m.id} message={m} findingIds={findingIds} onCite={onCite} onOpenFile={onOpenFile} onAsk={(text) => void send(text)} />
                ))}
                {status === "submitted" && <p className="animate-pulse text-sm text-muted-foreground">Thinking…</p>}
              </div>
            )}

            {stopped && stopped !== ChatStop.Done && !error && (
              <StopNotice stop={stopped} onContinue={() => void send(CONTINUE_PROMPT)} />
            )}

            {error && (
              <div role="alert" className="mt-4 flex items-start gap-2 rounded-md bg-red-500/5 px-3 py-2 text-sm text-red-700 ring-1 ring-red-500/20 ring-inset dark:text-red-300">
                <p className="flex-1">Couldn&apos;t get an answer: {error.message || "request failed"}</p>
                <Button size="xs" variant="ghost" onClick={() => void regenerate()}>
                  <RotateCcw />
                  Retry
                </Button>
              </div>
            )}
          </div>
        </div>

        {!pinned && messages.length > 0 && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={jumpToLatest}
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 bg-background shadow-md"
          >
            <ArrowDown />
            Latest
          </Button>
        )}
      </div>

      {queue.length > 0 && (
        <QueueList queue={queue} onEdit={unqueue} onRemove={(item) => setQueue((q) => q.filter((x) => x.id !== item.id))} />
      )}

      <form
        className="border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <div className={columnClassName}>
          <div className="flex items-end gap-2 rounded-lg border bg-background p-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
            <Textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              rows={1}
              placeholder={mode === ChatMode.Ask ? placeholder : CHAT_MODES[mode].placeholder}
              aria-label="Message"
              className="max-h-40 min-h-8 resize-none border-0 bg-transparent px-1.5 py-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            {busy && (
              <Button type="button" size="icon-sm" variant="outline" onClick={stopAnswer} aria-label="Stop answer">
                <Square />
              </Button>
            )}
            {busy && draft.trim() ? (
              <Button type="submit" size="icon-sm" variant="secondary" aria-label="Queue message">
                <ListPlus />
              </Button>
            ) : (
              !busy && (
                <Button type="submit" size="icon-sm" disabled={!draft.trim()} aria-label="Send">
                  <ArrowUp />
                </Button>
              )
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1">
            <ModePicker mode={mode} onChange={setMode} />
            <p className="hidden text-[11px] text-muted-foreground sm:block">
              <Kbd>Enter</Kbd> to {busy ? "queue" : "send"} · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> new line
            </p>
            {footer?.({ messages, busy, replace: setMessages })}
          </div>
        </div>
      </form>
    </div>
  );
}

// Picks what the next message is for; each mode has its own instructions.
function ModePicker({ mode, onChange }: { mode: ChatMode; onChange: (mode: ChatMode) => void }) {
  return (
    <ToggleGroup
      size="sm"
      spacing={0}
      value={[mode]}
      onValueChange={(values) => values[0] && onChange(values[0] as ChatMode)}
      aria-label="Chat mode"
      className="rounded-md border"
    >
      {MODES.map((m) => (
        <Tooltip key={m}>
          <TooltipTrigger render={<ToggleGroupItem value={m} className="h-6 px-2 text-[11px]" />}>{CHAT_MODES[m].label}</TooltipTrigger>
          <TooltipContent>{CHAT_MODES[m].hint}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}

// Messages waiting for the current answer. Click one to edit it.
function QueueList({ queue, onEdit, onRemove }: { queue: Queued[]; onEdit: (q: Queued) => void; onRemove: (q: Queued) => void }) {
  return (
    <div className="border-t bg-muted/30 px-3 py-2" aria-label="Queued messages">
      <p className="mb-1 text-[11px] text-muted-foreground">Queued · sent in order after the current answer</p>
      <ol className="flex flex-col gap-1">
        {queue.map((item, i) => (
          <li key={item.id} className="flex items-center gap-2 text-xs">
            <span className="w-4 shrink-0 text-right text-muted-foreground tabular-nums">{i + 1}</span>
            {item.mode !== ChatMode.Ask && (
              <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] font-medium">{CHAT_MODES[item.mode].label}</span>
            )}
            <button
              type="button"
              onClick={() => onEdit(item)}
              title="Edit"
              className="min-w-0 flex-1 truncate text-left outline-none hover:underline focus-visible:underline"
            >
              {item.text}
            </button>
            <Button type="button" size="icon-xs" variant="ghost" onClick={() => onRemove(item)} aria-label="Remove from queue">
              <X />
            </Button>
          </li>
        ))}
      </ol>
    </div>
  );
}

// e.g. ("/api/projects/1/chat", { threadId: 3 }) → "/api/projects/1/chat?threadId=3".
function liveUrl(api: string, body: object): string {
  const query = new URLSearchParams(
    Object.entries(body).flatMap(([k, v]) => (v === null || v === undefined ? [] : [[k, String(v)]])),
  ).toString();
  return query ? `${api}?${query}` : api;
}

// Keeps the conversation scrolled to the bottom while content grows (tokens,
// tool output, the stop notice, a taller composer), until the user scrolls
// up to read. Scrolling back to the bottom, sending, or "Latest" re-pins.
//
//   pinned ──user scrolls up──► unpinned ──reaches bottom / sends──► pinned
//
// Growth is watched with a ResizeObserver, which runs before paint: no
// visible jump, and it catches changes no message prop reflects.
function useStickToBottom() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const lastTop = useRef(0);
  const [pinned, setPinned] = useState(true);

  function pin(next: boolean) {
    pinnedRef.current = next;
    setPinned(next);
  }

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    observer.observe(el);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Only an upward move unpins: content shrinking at the bottom (e.g. the
  // thinking block collapsing) clamps scrollTop but stays at the bottom.
  function onScroll() {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const movedUp = el.scrollTop < lastTop.current;
    lastTop.current = el.scrollTop;

    if (distance <= STICK_DISTANCE_PX) {
      pin(true);
      return;
    }

    if (movedUp) {
      pin(false);
    }
  }

  function follow() {
    pin(true);
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }

  function jumpToLatest() {
    pin(true);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }

  return { scrollRef, contentRef, onScroll, pinned, follow, jumpToLatest };
}

const STOP_TEXT: Record<Exclude<ChatStop, ChatStop.Done>, { title: string; hint: string }> = {
  [ChatStop.OutputLimit]: {
    title: "The answer hit the model's output token limit.",
    hint: "Raise Max output tokens in the model's settings for longer answers.",
  },
  [ChatStop.StepLimit]: {
    title: "Stopped after the maximum number of tool calls.",
    hint: "Continue to let it keep reading, or ask a narrower question.",
  },
};

function StopNotice({ stop, onContinue }: { stop: Exclude<ChatStop, ChatStop.Done>; onContinue: () => void }) {
  const text = STOP_TEXT[stop];

  return (
    <div role="status" className="mt-4 flex items-start gap-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm ring-1 ring-amber-500/25 ring-inset">
      <div className="flex-1">
        <p className="font-medium">{text.title}</p>
        <p className="text-xs text-muted-foreground">{text.hint}</p>
      </div>
      <Button size="xs" variant="outline" onClick={onContinue}>
        <CornerDownRight />
        Continue
      </Button>
    </div>
  );
}

function Starters({ starters, onPick }: { starters: string[]; onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">Try asking:</p>
      {starters.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className="rounded-md border px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
