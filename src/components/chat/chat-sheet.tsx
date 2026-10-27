"use client";

import { useRef } from "react";
import type { UIMessage } from "ai";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChatPanel, type ChatHandle } from "./chat-panel";

// Review chat in a right-side sheet. The conversation lives in this
// component, so it survives closing the sheet.

export type { ChatHandle };

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

export function ChatSheet({ title, description, open, onOpenChange, ...chat }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" initialFocus={inputRef} className="w-full gap-0 p-0 data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <ChatPanel id={chat.api} inputRef={inputRef} {...chat} />
      </SheetContent>
    </Sheet>
  );
}
