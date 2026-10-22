"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUp, RotateCcw, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ChatMessage } from "./chat-message";

// Chat in a right-side sheet: about a review, or about the codebase. The
// conversation lives in this component, so it survives closing the sheet.

const NO_FINDINGS = new Set<number>();

// Lets the report prefill or send a message, e.g. from a finding's "Ask".
export type ChatHandle = {
  prefill: (text: string) => void;
  send: (text: string) => void;
};

type Props = {
  ref?: React.Ref<ChatHandle>;
  // useChat endpoint, e.g. /api/reviews/3/chat.
  api: string;
  title: string;
  description: string;
  starters: string[];
  placeholder: string;
  initialMessages: UIMessage[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Findings that "#12" in answers can jump to.
  findingIds?: Set<number>;
  onCite?: (id: number) => void;
};

export function ChatSheet(props: Props) {
  const { ref, api, title, description, starters, placeholder, initialMessages, open, onOpenChange } = props;
  const { findingIds = NO_FINDINGS, onCite = () => {} } = props;
  const [transport] = useState(() => new DefaultChatTransport({ api }));
  const { messages, sendMessage, status, stop, error, regenerate } = useChat({
    id: api,
    messages: initialMessages,
    transport,
  });
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  function send(text: string) {
    if (!text.trim()) {
      return;
    }

    if (busy) {
      toast.info("Wait for the current answer, or stop it");
      return;
    }

    void sendMessage({ text: text.trim() });
    setDraft("");
  }

  useImperativeHandle(ref, () => ({
    prefill: (text) => setDraft(text),
    send,
  }));

  // Follow new content as it streams in.
  const last = messages.at(-1);
  const lastLength = last ? JSON.stringify(last.parts).length : 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, lastLength, open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" initialFocus={inputRef} className="w-full gap-0 p-0 data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
          {messages.length === 0 ? (
            <Starters starters={starters} onPick={send} />
          ) : (
            <div className="flex flex-col gap-5">
              {messages.map((m) => (
                <ChatMessage key={m.id} message={m} findingIds={findingIds} onCite={onCite} />
              ))}
              {status === "submitted" && <p className="animate-pulse text-sm text-muted-foreground">Thinking…</p>}
            </div>
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
          <div ref={endRef} />
        </div>

        <form
          className="border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <div className="flex items-end gap-2 rounded-lg border bg-background p-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
            <Textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(draft);
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
          <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
            <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a new line
          </p>
        </form>
      </SheetContent>
    </Sheet>
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
