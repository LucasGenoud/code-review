"use client";

import { useState, useTransition } from "react";
import { ListPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Severity } from "@/lib/domain";
import { parseBulkRules } from "@/lib/bulk-rules";
import { addRules } from "@/app/rules/actions";
import { SeveritySelect } from "./severity-select";

const EXAMPLE = "Named constants | Use named constants for meaningful values.\nEarly returns | Return early to reduce nesting.";

// Preview pasted names and descriptions before adding them together.
export function BulkRulesForm({ categoryId, projectId }: { categoryId: number; projectId: number | null }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [severity, setSeverity] = useState(Severity.Minor);
  const [pending, startTransition] = useTransition();
  const { rules, errors } = parseBulkRules(text);
  const valid = rules.length > 0 && errors.length === 0;

  // Keep the draft on failure; clear it only after a successful batch.
  function submit() {
    if (pending || !valid) {
      return;
    }

    startTransition(async () => {
      const result = await addRules(categoryId, projectId, rules.map((rule) => ({ ...rule, severity, enabled: true })));
      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(`Added ${result.data} ${result.data === 1 ? "rule" : "rules"}`);
      setText("");
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <div className="px-4 pb-3">
        <Button variant="outline" size="xs" onClick={() => setOpen(true)}>
          <ListPlus />
          Add multiple rules
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t bg-muted/30 px-4 py-4">
      <label className="text-sm font-medium">
        Add multiple rules
        <span className="mb-2 mt-1 block text-sm font-normal text-muted-foreground">
          Paste one Name | Description pair per line. Bullets and numbering are optional.
        </span>
        <Textarea
          autoFocus
          value={text}
          disabled={pending}
          onChange={(e) => setText(e.target.value)}
          placeholder={EXAMPLE}
          className="min-h-36 bg-background text-sm"
          aria-invalid={errors.length > 0}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>

      {errors.length > 0 && (
        <ul role="alert" className="text-sm text-destructive">
          {errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}

      {rules.length > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <p className="mb-2 text-sm font-medium">Preview · {rules.length} {rules.length === 1 ? "rule" : "rules"}</p>
          <ul className="max-h-60 space-y-3 overflow-y-auto text-sm">
            {rules.map((rule, index) => (
              <li key={index} className="break-words">
                <p className="font-medium">{rule.name}</p>
                <p className="text-muted-foreground">{rule.description}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SeveritySelect value={severity} onChange={setSeverity} label="Severity for all pasted rules" />
        <span className="text-xs text-muted-foreground">
          {projectId === null ? "Added for all projects." : "Added for this project only."}
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" disabled={pending || !valid} onClick={submit}>
            {pending && <Loader2 className="animate-spin" />}
            {rules.length > 0 ? `Add ${rules.length} ${rules.length === 1 ? "rule" : "rules"}` : "Add rules"}
          </Button>
        </div>
      </div>
    </div>
  );
}
