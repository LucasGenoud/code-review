"use client";

import { useState, useTransition } from "react";
import { Loader2, Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Kbd } from "@/components/ui/kbd";
import { AutoRefresh } from "@/components/projects/auto-refresh";
import { describeProject, saveProjectSettings, type Project } from "@/app/actions";
import { Panel } from "./panel";

const PARAGRAPH = /\n\s*\n/;
const HEADING = /^#{1,6}\s+(.+)$/gm;
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/;

// Project description, sent to the model as context with every review.
// Editable by hand or regenerated from README, manifests and file tree.
export function DescriptionPanel({ project, describing }: { project: Project; describing: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.description);
  const [saving, startSave] = useTransition();
  const [generating, startGenerate] = useTransition();

  function edit() {
    setDraft(project.description);
    setEditing(true);
  }

  function save() {
    startSave(async () => {
      const result = await saveProjectSettings(project.id, {
        description: draft,
        ignoreGlobs: project.ignoreGlobs,
        modelId: project.modelId,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }

      setEditing(false);
    });
  }

  function regenerate() {
    startGenerate(async () => {
      const result = await describeProject(project.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }

      setEditing(false);
      toast.success("Description updated");
    });
  }

  // Ctrl/Cmd+Enter saves, Esc cancels.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setEditing(false);
      return;
    }

    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      save();
    }
  }

  const busy = generating || describing;

  return (
    <Panel
      title="Description"
      hint="Context the model reads before every review."
      action={
        !editing && (
          <div className="flex gap-1">
            <Button variant="ghost" size="xs" onClick={regenerate} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Regenerate
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="Edit description" onClick={edit} disabled={busy}>
              <Pencil />
            </Button>
          </div>
        )
      }
    >
      {describing && <AutoRefresh />}

      {busy && <DescribeSkeleton />}

      {!busy && editing && (
        <div className="flex flex-col gap-2">
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            className="max-h-96 min-h-32 text-sm"
            aria-label="Project description"
          />
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-muted-foreground">
              <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> to save
            </span>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </div>
        </div>
      )}

      {!busy && !editing && project.description && (
        <Prose text={project.description} />
      )}

      {!busy && !editing && !project.description && (
        <p className="text-sm text-muted-foreground">
          No description yet. Write one or regenerate it so the model knows what the project does.
        </p>
      )}
    </Panel>
  );
}

// Paragraphs (blank-line separated) with **bold** and `code`. Headings
// ("## Stack") render bold. Enough for LLM output without a markdown lib.
function Prose({ text }: { text: string }) {
  return (
    <div className="flex max-h-80 flex-col gap-2 overflow-y-auto text-sm leading-relaxed text-foreground/90">
      {text.split(PARAGRAPH).map((para, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {inline(para.replace(HEADING, "**$1**"))}
        </p>
      ))}
    </div>
  );
}

function inline(text: string): React.ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-medium text-foreground">{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={i} className="rounded bg-muted px-1 font-mono text-xs">{part.slice(1, -1)}</code>;
    }

    return part;
  });
}

function DescribeSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <p className="text-xs text-muted-foreground">Generating description…</p>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-11/12" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  );
}
