"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ConfirmButton } from "@/components/projects/confirm-button";
import { IndexPhase, type SemanticStatus } from "@/lib/semantic";
import { buildSemanticIndex, removeSemanticIndex, semanticStatus, stopSemanticIndex } from "@/app/actions";
import { Panel } from "./panel";

// The project's semantic search index: build it once, then changed files
// update on their own as the chat runs. Polls while building.
//
//   Not built  → [Build index]
//   Building   → ▓▓▓▓░░ 1,200 / 3,400 chunks · 410k tokens  [Stop]
//   Ready      → 3,400 chunks from 812 files  [Update] [🗑]

const POLL_MS = 1_000;
const THOUSAND = 1_000;

export function SemanticPanel({ projectId, initial }: { projectId: number; initial: SemanticStatus }) {
  const [status, setStatus] = useState(initial);
  const [pending, startTransition] = useTransition();
  const building = status.phase === IndexPhase.Building;

  // Progress while building; stops once the run ends.
  useEffect(() => {
    if (!building) {
      return;
    }

    const timer = setInterval(async () => setStatus(await semanticStatus(projectId)), POLL_MS);
    return () => clearInterval(timer);
  }, [building, projectId]);

  function build() {
    startTransition(async () => {
      const result = await buildSemanticIndex(projectId);
      if (result.error) {
        toast.error(result.error);
        return;
      }

      setStatus(await semanticStatus(projectId));
    });
  }

  function stop() {
    startTransition(async () => {
      await stopSemanticIndex(projectId);
      setStatus(await semanticStatus(projectId));
    });
  }

  const hint = "Lets the chat find code by meaning, not only by words. Built once, then kept up to date as files change.";

  if (!status.configured) {
    return (
      <Panel title="Semantic search" hint={hint}>
        <p className="text-sm text-muted-foreground">
          No embedding model set.{" "}
          <Link href="/settings" className="text-foreground underline underline-offset-2">
            Choose one in Settings
          </Link>
          .
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Semantic search" hint={hint}>
      {building ? (
        <Building status={status} onStop={stop} pending={pending} />
      ) : (
        <Summary status={status} />
      )}

      {status.phase === IndexPhase.Failed && status.error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {status.error}
        </p>
      )}

      {!building && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant={status.chunks > 0 ? "outline" : "default"} onClick={build} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : status.chunks > 0 ? <RefreshCw /> : <Sparkles />}
            {status.chunks > 0 && !status.stale ? "Update" : status.stale ? "Rebuild" : "Build index"}
          </Button>
          {(status.chunks > 0 || status.stale) && (
            <ConfirmButton
              label="Delete semantic index"
              title="Delete the semantic index?"
              description="The chat goes back to word search. Building it again embeds the code again."
              onConfirm={async () => {
                await removeSemanticIndex(projectId);
                setStatus(await semanticStatus(projectId));
              }}
            />
          )}
        </div>
      )}
    </Panel>
  );
}

function Building({ status, onStop, pending }: { status: SemanticStatus; onStop: () => void; pending: boolean }) {
  const percent = status.total > 0 ? Math.round((100 * status.done) / status.total) : 0;

  return (
    <div className="flex flex-col gap-2">
      <Progress value={percent} aria-label="Indexing progress" />
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {status.total === 0 ? "Reading files…" : `${status.done.toLocaleString()} / ${status.total.toLocaleString()} chunks`}
          {status.tokens > 0 && ` · ${tokens(status.tokens)} tokens`}
        </span>
        <Button size="xs" variant="outline" onClick={onStop} disabled={pending}>
          <Square />
          Stop
        </Button>
      </div>
    </div>
  );
}

function Summary({ status }: { status: SemanticStatus }) {
  if (status.chunks === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {status.stale ? "Built with another embedding model: rebuild to use the current one." : "Not built yet. Embeds the project's code once; this costs tokens on paid APIs."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 text-sm">
      <p>
        {status.chunks.toLocaleString()} chunks from {status.files.toLocaleString()} files
        {status.tokens > 0 && <span className="text-muted-foreground"> · last run {tokens(status.tokens)} tokens</span>}
      </p>
      {status.capped && <p className="text-xs text-muted-foreground">Size limit reached: tests and some files were left out.</p>}
    </div>
  );
}

// 410000 → "410k".
function tokens(n: number): string {
  return n >= THOUSAND ? `${Math.round(n / THOUSAND)}k` : String(n);
}
