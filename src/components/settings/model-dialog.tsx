"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { saveModel, type Model } from "@/app/settings/actions";

const DEFAULT_CONTEXT = 128_000;
const DEFAULT_CONCURRENCY = 4;
const MAX_SUGGESTIONS = 8;

type Form = {
  name: string;
  contextWindow: string;
  maxConcurrency: string;
  inputCost: string;
  outputCost: string;
  toolCalling: boolean;
  jsonSchema: boolean;
};

type Props = {
  providerId: number;
  // Edit this model; absent = create.
  model?: Model;
  // Model ids the provider reported, offered while typing the name.
  suggestions: string[];
  // Loads suggestions from the provider.
  onLoadSuggestions: () => void;
  loadingSuggestions: boolean;
  trigger: React.ReactElement;
  children: React.ReactNode;
};

// Create or edit a model of a provider.
export function ModelDialog({ providerId, model, suggestions, onLoadSuggestions, loadingSuggestions, trigger, children }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(initial(model));
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setForm(initial(model));
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await saveModel({
        id: model?.id,
        providerId,
        name: form.name,
        contextWindow: Number(form.contextWindow),
        maxConcurrency: Number(form.maxConcurrency),
        inputCost: form.inputCost.trim() ? Number(form.inputCost) : null,
        outputCost: form.outputCost.trim() ? Number(form.outputCost) : null,
        toolCalling: form.toolCalling,
        jsonSchema: form.jsonSchema,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }

      setOpen(false);
      toast.success(model ? "Model saved" : `Added ${form.name}`);
    });
  }

  const query = form.name.trim().toLowerCase();
  const matches = suggestions.filter((s) => s.toLowerCase().includes(query) && s !== form.name).slice(0, MAX_SUGGESTIONS);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger}>{children}</DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{model ? `Edit ${model.name}` : "Add model"}</DialogTitle>
            <DialogDescription>The model id exactly as the provider names it.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="model-name">Model id</Label>
              <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={onLoadSuggestions} disabled={loadingSuggestions}>
                {loadingSuggestions ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {suggestions.length ? "Reload list" : "Load from provider"}
              </Button>
            </div>
            <Input
              id="model-name"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="e.g. gpt-4.1-mini"
              className="font-mono text-xs md:text-xs"
              required
              autoFocus
              autoComplete="off"
            />
            {matches.length > 0 && (
              <div className="flex flex-wrap gap-1" aria-label="Suggestions">
                {matches.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => set({ name: s })}
                    className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberField id="model-context" label="Context window" hint="Tokens" value={form.contextWindow} onChange={(v) => set({ contextWindow: v })} required />
            <NumberField
              id="model-concurrency"
              label="Max concurrency"
              hint="Parallel requests during a review"
              value={form.maxConcurrency}
              onChange={(v) => set({ maxConcurrency: v })}
              required
            />
            <NumberField id="model-input-cost" label="Input cost" hint="USD per 1M tokens, optional" value={form.inputCost} onChange={(v) => set({ inputCost: v })} step="any" />
            <NumberField id="model-output-cost" label="Output cost" hint="USD per 1M tokens, optional" value={form.outputCost} onChange={(v) => set({ outputCost: v })} step="any" />
          </div>

          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <SwitchField
              id="model-tools"
              label="Tool calling"
              hint="Lets the review chat read project files and run code."
              checked={form.toolCalling}
              onChange={(toolCalling) => set({ toolCalling })}
            />
            <SwitchField
              id="model-json"
              label="JSON schema output"
              hint="Turn off for servers that reject structured outputs."
              checked={form.jsonSchema}
              onChange={(jsonSchema) => set({ jsonSchema })}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !form.name.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              {model ? "Save" : "Add model"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type NumberProps = {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  step?: string;
};

function NumberField({ id, label, hint, value, onChange, required, step }: NumberProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min={0} step={step} value={value} onChange={(e) => onChange(e.target.value)} required={required} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

type SwitchProps = { id: string; label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void };

function SwitchField({ id, label, hint, checked, onChange }: SwitchProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function initial(model?: Model): Form {
  return {
    name: model?.name ?? "",
    contextWindow: String(model?.contextWindow ?? DEFAULT_CONTEXT),
    maxConcurrency: String(model?.maxConcurrency ?? DEFAULT_CONCURRENCY),
    inputCost: model?.inputCost == null ? "" : String(model.inputCost),
    outputCost: model?.outputCost == null ? "" : String(model.outputCost),
    toolCalling: model?.toolCalling ?? true,
    jsonSchema: model?.jsonSchema ?? true,
  };
}
