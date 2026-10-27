"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "cn";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { readCodebaseFile } from "@/app/actions";

// A working tree file cited in an answer, read-only, scrolled to the cited
// line, which is highlighted.

export type FileRef = { path: string; line: number };

type Props = { projectId: number; file: FileRef | null; onClose: () => void };

type Loaded = { path: string; lines: string[] } | { path: string; error: string };

export function FileSheet({ projectId, file, onClose }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const current = loaded && file && loaded.path === file.path ? loaded : null;

  useEffect(() => {
    if (!file || loaded?.path === file.path) {
      return;
    }

    void readCodebaseFile(projectId, file.path).then((result) =>
      setLoaded(result.error !== undefined ? { path: file.path, error: result.error } : { path: file.path, lines: result.data.split(/\r?\n/) }),
    );
  }, [projectId, file, loaded]);

  // Center the cited line once the file shows.
  useEffect(() => {
    lineRef.current?.scrollIntoView({ block: "center" });
  }, [current, file?.line]);

  return (
    <Sheet open={file !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="truncate font-mono text-sm">{file?.path}</SheetTitle>
          <SheetDescription>Working tree, line {file?.line}. Read-only.</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto py-2 font-mono text-xs leading-relaxed">
          {!current && (
            <p className="flex items-center gap-2 px-4 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Loading…
            </p>
          )}
          {current && "error" in current && <p className="px-4 text-red-700 dark:text-red-300">{current.error}</p>}
          {current &&
            "lines" in current &&
            current.lines.map((text, i) => {
              const cited = i + 1 === file?.line;
              return (
                <div
                  key={i}
                  ref={cited ? lineRef : undefined}
                  className={cn("flex min-w-max", cited && "bg-amber-500/15")}
                >
                  <span className="w-12 shrink-0 pr-3 text-right text-muted-foreground select-none">{i + 1}</span>
                  <span className="pr-4 whitespace-pre">{text}</span>
                </div>
              );
            })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
