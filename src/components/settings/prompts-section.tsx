"use client";

import { useState, useTransition } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { savePrompt, type PromptView } from "@/app/settings/actions";

// Instructions sent to the model, one editor each. Collapsed by default:
// most users never change them.
export function PromptsSection({ prompts }: { prompts: PromptView[] }) {
  return (
    <div className="flex flex-col rounded-xl border bg-card">
      <p className="border-b px-4 py-3 text-xs leading-5 text-muted-foreground">
        What the reviewer is told at each step. Output formats are added automatically, so edits can&apos;t break parsing.
      </p>
      {prompts.map((p) => (
        <PromptEditor key={p.key} prompt={p} />
      ))}
    </div>
  );
}

function PromptEditor({ prompt }: { prompt: PromptView }) {
  const [text, setText] = useState(prompt.text);
  const [pending, startTransition] = useTransition();
  const edited = prompt.text !== prompt.defaultText;
  const dirty = text !== prompt.text;

  // Empty text restores the default. Mirrors the server's trim, so the
  // editor matches what's stored.
  function save(value: string, done: string) {
    setText(value.trim() || prompt.defaultText);
    startTransition(async () => {
      const result = await savePrompt(prompt.key, value);
      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(done);
    });
  }

  return (
    <Collapsible className="border-b last:border-b-0">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90" aria-hidden />
        <span className="text-sm font-medium">{prompt.label}</span>
        {edited && <Badge variant="secondary">Edited</Badge>}
        <span className="ml-auto hidden truncate text-xs text-muted-foreground sm:block">{prompt.help}</span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="flex flex-col gap-3 px-4 pb-4 pl-10">
          <p className="text-xs text-muted-foreground sm:hidden">{prompt.help}</p>
          <Textarea
            aria-label={`${prompt.label} prompt`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="max-h-[60vh] min-h-40 font-mono text-xs md:text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending || (!edited && !dirty)}
              onClick={() => save("", `${prompt.label} prompt reset`)}
            >
              Reset to default
            </Button>
            <Button type="button" size="sm" disabled={pending || !dirty} onClick={() => save(text, `${prompt.label} prompt saved`)}>
              {pending && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
