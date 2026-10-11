"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveSettings, type AppSettings } from "@/app/settings/actions";
import { ModelSelect, type ModelOption } from "./model-select";

// Default model, global ignore globs and the per-category pass threshold.
export function ReviewSettingsForm({ settings, models }: { settings: AppSettings; models: ModelOption[] }) {
  const [form, setForm] = useState(settings);
  const [threshold, setThreshold] = useState(String(settings.passThreshold));
  const [pending, startTransition] = useTransition();

  const dirty =
    form.defaultModelId !== settings.defaultModelId ||
    form.ignoreGlobs !== settings.ignoreGlobs ||
    threshold !== String(settings.passThreshold);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await saveSettings({ ...form, passThreshold: Number(threshold) });
      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Review settings saved");
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 rounded-xl border bg-card p-4">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="default-model">Default model</Label>
          <ModelSelect
            id="default-model"
            models={models}
            value={form.defaultModelId}
            onChange={(defaultModelId) => setForm((f) => ({ ...f, defaultModelId }))}
            nullLabel="None"
          />
          <p className="text-xs text-muted-foreground">Used by every project that doesn&apos;t pick its own model.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pass-threshold">Rules per pass</Label>
          <Input
            id="pass-threshold"
            type="number"
            min={1}
            max={200}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className="w-28"
            required
          />
          <p className="text-xs text-muted-foreground">
            Above this many rules for a file, each category gets its own LLM pass, so long rule lists don&apos;t dilute the
            model&apos;s attention.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ignore-globs">Ignored files</Label>
        <Textarea
          id="ignore-globs"
          value={form.ignoreGlobs}
          onChange={(e) => setForm((f) => ({ ...f, ignoreGlobs: e.target.value }))}
          className="max-h-72 min-h-32 font-mono text-xs md:text-xs"
        />
        <p className="text-xs text-muted-foreground">One glob per line. Matching files are never reviewed, e.g. lock files and build output.</p>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={!dirty || pending}>
          {pending && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}
