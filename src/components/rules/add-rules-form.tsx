"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Severity } from "@/lib/domain";
import { addRules } from "@/app/rules/actions";
import { SeveritySelect } from "./severity-select";

type Props = {
  categoryId: number;
  // Set: rules exist only in this project, even in a global category.
  projectId: number | null;
};

// Paste a list, one rule per line. Bullets and numbering are stripped.
export function AddRulesForm({ categoryId, projectId }: Props) {
  const [open, setOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [severity, setSeverity] = useState(Severity.Minor);
  const [pending, startTransition] = useTransition();

  const count = pasted.split("\n").filter((l) => l.trim()).length;

  function submit() {
    startTransition(async () => {
      const result = await addRules(categoryId, projectId, pasted, severity);
      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(`Added ${result.data} ${result.data === 1 ? "rule" : "rules"}`);
      setPasted("");
      setOpen(false);
    });
  }

  // Ctrl/Cmd+Enter adds, Esc closes.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }

    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && count > 0) {
      submit();
    }
  }

  if (!open) {
    return (
      <div className="px-4 py-2">
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setOpen(true)}>
          <Plus />
          Add rules
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t bg-muted/30 px-4 py-3">
      <Textarea
        autoFocus
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={"One rule per line, e.g.\n- Functions do one thing\n- No magic numbers"}
        aria-label="Rules to add, one per line"
        className="min-h-24 bg-background text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <SeveritySelect value={severity} onChange={setSeverity} label="Severity of new rules" />
        <span className="text-xs text-muted-foreground">
          {projectId === null ? "Added for all projects." : "Added for this project only."} Bullets and numbering are removed.
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={pending || count === 0}>
            {pending && <Loader2 className="animate-spin" />}
            Add {count > 0 ? count : ""} {count === 1 ? "rule" : "rules"}
          </Button>
        </div>
      </div>
    </div>
  );
}
