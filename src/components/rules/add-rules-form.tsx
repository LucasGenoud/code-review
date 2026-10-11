"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Severity } from "@/lib/domain";
import { addRules } from "@/app/rules/actions";
import { SeveritySelect } from "./severity-select";

type Props = {
  categoryId: number;
  // Set: rules exist only in this project, even in a global category.
  projectId: number | null;
};

// Separate the rule label from the instructions used by the model.
export function AddRulesForm({ categoryId, projectId }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState(Severity.Minor);
  const [pending, startTransition] = useTransition();

  const valid = Boolean(name.trim() && description.trim());

  function submit() {
    startTransition(async () => {
      const result = await addRules(categoryId, projectId, { name, description, severity, enabled: true });
      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(`Added ${result.data} ${result.data === 1 ? "rule" : "rules"}`);
      setName("");
      setDescription("");
      setOpen(false);
    });
  }

  // Ctrl/Cmd+Enter adds, Esc closes.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }

    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && valid) {
      submit();
    }
  }

  if (!open) {
    return (
      <div className="px-4 py-2">
        <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setOpen(true)}>
          <Plus />
          Add rule
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t bg-muted/30 px-4 py-3">
      <label className="text-sm font-medium">
        Name
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onKeyDown} placeholder="No magic numbers" className="mt-1 bg-background" />
      </label>
      <label className="text-sm font-medium">
        Description
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} onKeyDown={onKeyDown} placeholder="Use named constants for recurring or meaningful values." className="mt-1 min-h-24 bg-background text-sm" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <SeveritySelect value={severity} onChange={setSeverity} label="Severity of new rules" />
        <span className="text-xs text-muted-foreground">
          {projectId === null ? "Added for all projects." : "Added for this project only."}
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={pending || !valid}>
            {pending && <Loader2 className="animate-spin" />}
            Add rule
          </Button>
        </div>
      </div>
    </div>
  );
}
