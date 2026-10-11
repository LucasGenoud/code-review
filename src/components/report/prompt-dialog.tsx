"use client";

import { useState, useTransition } from "react";
import { Check, Copy, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { unitPrompt, type UnitView } from "@/app/reviews/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTokens } from "./report-lib";

// "View prompt" menu of a file: lists its review units (one per pass and
// chunk) and shows the exact prompt a unit sent to the model.

const COPIED_MS = 1500;

export function PromptMenu({ units }: { units: UnitView[] }) {
  const [unit, setUnit] = useState<UnitView | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (units.length === 0) {
    return null;
  }

  function show(u: UnitView) {
    setUnit(u);
    setPrompt(null);
    startTransition(async () => {
      const result = await unitPrompt(u.id);
      if (result.error !== undefined) {
        toast.error(result.error);
        setUnit(null);
        return;
      }

      setPrompt(result.data);
    });
  }

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-xs" aria-label="View prompts sent to the model" />}
              />
            }
          >
            <ScrollText />
          </TooltipTrigger>
          <TooltipContent>View prompts</TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Prompts sent for this file</DropdownMenuLabel>
            {units.map((u) => (
              <DropdownMenuItem key={u.id} onClick={() => show(u)}>
                <span className="flex-1">{unitLabel(u)}</span>
                <span className="text-xs text-muted-foreground">{u.status}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={unit !== null} onOpenChange={(open) => !open && setUnit(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Prompt · {unit && unitLabel(unit)}</DialogTitle>
            <DialogDescription>
              Exact text sent to the model
              {unit && unit.inputTokens > 0 && ` · ${formatTokens(unit.inputTokens)} in, ${formatTokens(unit.outputTokens)} out tokens`}
            </DialogDescription>
          </DialogHeader>

          {prompt === null ? (
            <div className="flex flex-col gap-2 rounded-md bg-muted p-3">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ) : (
            <>
              <pre className="min-h-0 flex-1 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
                {prompt}
              </pre>
              <div className="flex justify-end">
                <CopyButton text={prompt} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// "Bugs · part 2".
function unitLabel(u: UnitView): string {
  return `${u.pass} · part ${u.chunk + 1}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  }

  return (
    <Button variant="outline" size="sm" onClick={copy}>
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
