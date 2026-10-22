"use client";

import { useRef, useState } from "react";
import { FileCode, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PastedFile } from "@/app/actions";

// Code that isn't in the repository: dropped or chosen files, plus one paste
// box. The name's extension picks the language rules, e.g. "snippet.py".
//
//   ┌ ⇪ Drop files here or [Choose files] ┐
//   └─────────────────────────────────────┘
//   ▢ report.py   30 lines             [x]
//   Name [snippet.py]
//   [ paste code…                         ]

export const DEFAULT_PASTE_NAME = "snippet.txt";

// Larger files are skipped: the review would cost too much.
const MAX_FILE_BYTES = 1024 * 1024;
const NUL = "\0";

export type PasteState = { files: PastedFile[]; name: string; text: string };

export const EMPTY_PASTE: PasteState = { files: [], name: DEFAULT_PASTE_NAME, text: "" };

// Files sent for review: dropped ones, then the paste box if filled. A
// dropped file with the paste box's name is replaced by the box.
export function pastedFiles(state: PasteState): PastedFile[] {
  const name = state.name.trim() || DEFAULT_PASTE_NAME;
  if (!state.text.trim()) {
    return state.files;
  }

  return [...state.files.filter((f) => f.name !== name), { name, text: state.text }];
}

type Props = { value: PasteState; onChange: (value: PasteState) => void };

export function PastedFiles({ value, onChange }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reads files in the browser; skips folders, binaries and big files.
  async function add(list: FileList | null) {
    const read: PastedFile[] = [];
    for (const file of Array.from(list ?? [])) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} is over 1 MB: skipped`);
        continue;
      }

      const text = await file.text().catch(() => null);
      if (text === null || text.includes(NUL)) {
        toast.error(`${file.name} isn't a text file: skipped`);
        continue;
      }

      read.push({ name: file.name, text });
    }

    // Same name again replaces the earlier file.
    const names = new Set(read.map((f) => f.name));
    onChange({ ...value, files: [...value.files.filter((f) => !names.has(f.name)), ...read] });
  }

  function remove(name: string) {
    onChange({ ...value, files: value.files.filter((f) => f.name !== name) });
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void add(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground transition-colors",
          dragging && "border-primary bg-primary/5 text-foreground",
        )}
      >
        <Upload className="size-5" aria-hidden />
        <p>
          Drop files here, or{" "}
          <Button type="button" variant="link" className="h-auto p-0" onClick={() => inputRef.current?.click()}>
            choose files
          </Button>
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            void add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {value.files.length > 0 && (
        <ul className="divide-y rounded-lg border text-xs">
          {value.files.map((f) => (
            <li key={f.name} className="flex items-center gap-2 px-2.5 py-1">
              <FileCode className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono">{f.name}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{f.text.replace(/\n$/, "").split("\n").length} lines</span>
              <Button type="button" size="icon-xs" variant="ghost" onClick={() => remove(f.name)} aria-label={`Remove ${f.name}`}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Label htmlFor="paste-name" className="text-xs text-muted-foreground">Name</Label>
          <Input
            id="paste-name"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder={DEFAULT_PASTE_NAME}
            className="h-7 w-48 font-mono text-xs"
          />
          <span className="text-xs text-muted-foreground">The extension picks the language rules.</span>
        </div>
        <Textarea
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          placeholder="Or paste code here…"
          aria-label="Pasted code"
          spellCheck={false}
          className="max-h-80 min-h-28 font-mono text-xs"
        />
      </div>
    </div>
  );
}
