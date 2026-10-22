"use client";

import { useState } from "react";
import type { UIMessage } from "ai";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatSheet } from "@/components/chat/chat-sheet";

// Read-only Q&A about the project's working tree, in a side sheet.

const STARTERS = [
  "Give me a tour of this codebase",
  "Where is the entry point and how does a request flow?",
  "Which parts look fragile or untested?",
  "How are errors handled?",
];

type Props = { projectId: number; initialMessages: UIMessage[] };

export function CodebaseChat({ projectId, initialMessages }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <MessageSquare />
        Ask the codebase
      </Button>
      <ChatSheet
        api={`/api/projects/${projectId}/chat`}
        title="Ask the codebase"
        description="Reads the working tree to answer. Never changes files."
        starters={STARTERS}
        placeholder="e.g. Where are API keys stored?"
        initialMessages={initialMessages}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
