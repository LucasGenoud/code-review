"use client";

import { useState, useTransition } from "react";
import { BookMarked, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/chat/markdown";
import { ConfirmButton } from "@/components/projects/confirm-button";
import { timeAgo } from "@/components/projects/review-status";
import { deleteProjectNote, editProjectNote, saveProjectNote, type NoteView } from "@/app/actions";

// Project memory on the Ask page: the notes list in the sidebar, and one
// dialog to save an answer, read a note, edit or delete it. Later chats
// get the notes in their instructions.
//
//   answer [Save to memory] ─► dialog (title, text) ─► Memory tab
//   Memory tab row ─► dialog: rendered note [Edit] [Delete]

const NO_FINDINGS = new Set<number>();
const MAX_TITLE = 120;

// What the dialog shows: a new note from an answer, or a saved one.
export type NoteTarget = { draft: { title: string; body: string } } | { note: NoteView };

type ListProps = { notes: NoteView[]; onOpen: (note: NoteView) => void };

export function MemoryList({ notes, onOpen }: ListProps) {
  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-xs text-muted-foreground">
        <BookMarked className="size-4" aria-hidden />
        <p>No notes yet. Use Save to memory on an answer: later chats start from it.</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {notes.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => onOpen(n)}
            className="flex w-full flex-col rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="truncate text-sm">{n.title}</span>
            <span className="text-[11px] text-muted-foreground">{timeAgo(n.updatedAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

type DialogProps = {
  projectId: number;
  target: NoteTarget | null;
  onClose: () => void;
  onSaved: (note: NoteView) => void;
  onDeleted: (id: number) => void;
  onOpenFile: (path: string, line: number) => void;
};

export function NoteDialog({ projectId, target, onClose, onSaved, onDeleted, onOpenFile }: DialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-4rem)] flex-col sm:max-w-2xl">
        {target && (
          <NoteBody key={"note" in target ? `n${target.note.id}` : "draft"} projectId={projectId} target={target} onClose={onClose} onSaved={onSaved} onDeleted={onDeleted} onOpenFile={onOpenFile} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NoteBody({ projectId, target, onClose, onSaved, onDeleted, onOpenFile }: DialogProps & { target: NoteTarget }) {
  const saved = "note" in target ? target.note : null;
  const initial = "note" in target ? target.note : target.draft;
  const [editing, setEditing] = useState(saved === null);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const input = { title, body };
      if (saved) {
        const result = await editProjectNote(projectId, saved.id, input);
        if (result.error !== undefined) {
          toast.error(result.error);
          return;
        }

        onSaved({ ...saved, title: title.trim(), body: body.trim(), updatedAt: new Date() });
        setEditing(false);
        return;
      }

      const result = await saveProjectNote(projectId, input);
      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      onSaved(result.data);
      toast.success("Saved to memory: later chats start from it");
      onClose();
    });
  }

  if (!editing && saved) {
    return (
      <>
        <DialogHeader>
          <DialogTitle className="pr-8">{saved.title}</DialogTitle>
          <DialogDescription>Project memory · updated {timeAgo(saved.updatedAt)} · later chats read it, then check the code</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto text-sm leading-relaxed">
          <Markdown text={saved.body} findingIds={NO_FINDINGS} onCite={() => {}} onOpenFile={onOpenFile} />
        </div>
        <DialogFooter>
          <ConfirmButton
            label={`Delete note ${saved.title}`}
            title="Delete this note?"
            description="Later chats won't see it any more."
            onConfirm={async () => {
              const result = await deleteProjectNote(projectId, saved.id);
              if (result.error === undefined) {
                onDeleted(saved.id);
                onClose();
              }
              return result;
            }}
          />
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil />
            Edit
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{saved ? "Edit note" : "Save to memory"}</DialogTitle>
        <DialogDescription>Later chats about this project get this note. Keep what stays true; cut the rest.</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="note-title">Title</Label>
          <Input id="note-title" value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <Label htmlFor="note-body">Note</Label>
          <Textarea id="note-body" value={body} onChange={(e) => setBody(e.target.value)} className={cn("min-h-48 flex-1 font-mono text-xs")} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => (saved ? setEditing(false) : onClose())}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending || !title.trim() || !body.trim()}>
          {pending && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

// "How are API keys stored?\n…" → "How are API keys stored?", cut to fit.
export function noteTitle(question: string): string {
  const line = question.trim().split("\n")[0].trim();
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line || "Saved answer";
}
