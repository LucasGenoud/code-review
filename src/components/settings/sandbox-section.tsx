"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RunnerState } from "@/lib/sandbox";
import { saveSandboxSettings, type SandboxStatus } from "@/app/settings/actions";

const STATE_DOTS: Record<RunnerState, string> = {
  [RunnerState.Online]: "bg-green-500",
  [RunnerState.Offline]: "bg-amber-500",
  [RunnerState.Missing]: "bg-muted-foreground/50",
};

// Code sandbox the review chat can use to run snippets. Off by default.
export function SandboxSection({ status }: { status: SandboxStatus }) {
  const [enabled, setEnabled] = useOptimistic(status.enabled);
  const [timeout, setTimeoutValue] = useState(String(status.timeoutSeconds));
  const [pending, startTransition] = useTransition();

  function save(next: { enabled: boolean; timeoutSeconds: number }) {
    startTransition(async () => {
      setEnabled(next.enabled);
      const result = await saveSandboxSettings(next);
      if (result.error) {
        toast.error(result.error);
      }
    });
  }

  const timeoutDirty = timeout !== String(status.timeoutSeconds);

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="sandbox-enabled">Let the chat agent run code</Label>
          <p className="text-xs text-muted-foreground">
            The review chat can run Python, JavaScript, TypeScript or Java to check how code behaves.
          </p>
        </div>
        <Switch id="sandbox-enabled" checked={enabled} onCheckedChange={(next) => save({ enabled: next, timeoutSeconds: status.timeoutSeconds })} />
      </div>

      <RunnerLine status={status} />

      {status.state === RunnerState.Missing && enabled && (
        <p className="text-xs text-amber-700 dark:text-amber-400">Enabled, but has no effect until a runner is configured.</p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sandbox-timeout">Time limit per run</Label>
          <div className="flex items-center gap-2">
            <Input
              id="sandbox-timeout"
              type="number"
              min={1}
              max={60}
              value={timeout}
              onChange={(e) => setTimeoutValue(e.target.value)}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">seconds (1–60)</span>
          </div>
        </div>
        {timeoutDirty && (
          <Button size="sm" onClick={() => save({ enabled, timeoutSeconds: Number(timeout) })} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Save
          </Button>
        )}
      </div>

      <p className="flex items-start gap-2 border-t pt-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-px size-3.5 shrink-0" />
        Code runs in a separate container with no network access, project files mounted read-only, and time and memory limits.
      </p>
    </div>
  );
}

function RunnerLine({ status }: { status: SandboxStatus }) {
  const text = {
    [RunnerState.Online]: `Runner online · ${status.languages.join(", ")}`,
    [RunnerState.Offline]: "Runner not responding. Is the sandbox container running?",
    [RunnerState.Missing]: null,
  }[status.state];

  return (
    <div className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
      <span className={cn("mt-1 size-2 shrink-0 rounded-full", STATE_DOTS[status.state])} aria-hidden />
      {text ?? (
        <span className="text-muted-foreground">
          No sandbox configured. With Docker Compose it runs as the <code className="font-mono">sandbox</code> service. For local
          dev, run <code className="font-mono">SANDBOX_DIR=./data/sandbox REPO_ROOT=… node sandbox/runner.mjs</code> and set{" "}
          <code className="font-mono">SANDBOX_DIR</code> in <code className="font-mono">.env.local</code> (no isolation outside
          Docker).
        </span>
      )}
    </div>
  );
}
