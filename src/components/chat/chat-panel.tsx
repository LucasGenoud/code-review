"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowDown, ArrowUp, CornerDownRight, RotateCcw, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { ChatStop, type ChatMetadata } from "@/lib/chat";
import { ChatMessage } from "./chat-message";

// A conversation and its composer, without chrome. Used in the review
// chat sheet and on the Ask the codebase page.
//
//   ┌ messages (scrolls, sticks to the bottom while streaming) ┐
//   │ stop notice: "hit the output limit" [Continue]            │
//   │                    [↓ Latest] (when scrolled up)          │
//   ├ composer ─────────────────────────────────────────────────┤
//   │ hints                                  footer (e.g. meter)│
//   └───────────────────────────────────────────────────────────┘

const NO_FINDINGS = new Set<number>();
// Within this many pixels of the bottom counts as at the bottom. Small, so a
// short scroll up while streaming isn't undone by the next token.
const STICK_DISTANCE_PX = 8;
const CONTINUE_PROMPT = "Continue where you stopped.";

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
  // Runs before a message goes out, e.g. to create its thread. false cancels.
  beforeSend?: (text: string) => Promise<boolean>;
  onAnswered?: () => void;
  // Right side of the composer's bottom line, e.g. the token meter.
  footer?: (chat: ChatState) => React.ReactNode;
  // Conversation column, e.g. "mx-auto max-w-3xl".
  columnClassName?: string;
  // Findings that "#12" in answers can jump to.
  findingIds?: Set<number>;
  onCite?: (id: number) => void;
};

export function ChatPanel(props: Props) {
  const { ref, id, api, starters, placeholder, initialMessages, beforeSend, onAnswered, footer, columnClassName } = props;
  const { findingIds = NO_FINDINGS, onCite = () => {} } = props;

  const [transport] = useState(() => new DefaultChatTransport({ api, body: props.body }));
  const { messages, sendMessage, setMessages, status, stop, error, regenerate } = useChat({
    id,
    messages: initialMessages,
    transport,
    onFinish: () => onAnswered?.(),
  });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const ownInputRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = props.inputRef ?? ownInputRef;
  const { scrollRef, contentRef, onScroll, pinned, follow, jumpToLatest } = useStickToBottom();
  const busy = sending || status === "submitted" || status === "streaming";

  async function send(text: string) {
    if (!text.trim()) {
      return;
    }

    if (busy) {
      toast.info("Wait for the current answer, or stop it");
      return;
    }

    setSending(true);
    try {
      if (beforeSend && !(await beforeSend(text.trim()))) {
        return;
      }

      follow();
      void sendMessage({ text: text.trim() });
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  useImperativeHandle(ref, () => ({
    prefill: (text) => setDraft(text),
    send: (text) => void send(text),
  }));

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
                  <ChatMessage key={m.id} message={m} findingIds={findingIds} onCite={onCite} />
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
              placeholder={placeholder}
              aria-label="Message"
              className="max-h-40 min-h-8 resize-none border-0 bg-transparent px-1.5 py-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            {busy ? (
              <Button type="button" size="icon-sm" variant="outline" onClick={() => void stop()} aria-label="Stop answer">
                <Square />
              </Button>
            ) : (
              <Button type="submit" size="icon-sm" disabled={!draft.trim()} aria-label="Send">
                <ArrowUp />
              </Button>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1">
            <p className="text-[11px] text-muted-foreground">
              <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a new line
            </p>
            {footer?.({ messages, busy, replace: setMessages })}
          </div>
        </div>
      </form>
    </div>
  );
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
