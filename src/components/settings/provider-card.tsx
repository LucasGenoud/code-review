"use client";

import { useState, useTransition } from "react";
import { KeyRound, Loader2, Pencil, Plug, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/projects/confirm-button";
import {
  fetchModelNames,
  removeModel,
  removeProvider,
  saveSettings,
  type AppSettings,
  type Model,
  type ProviderView,
} from "@/app/settings/actions";
import { ModelDialog } from "./model-dialog";
import { KIND_LABELS, ProviderDialog } from "./provider-dialog";

const THOUSAND = 1000;

type Props = {
  provider: ProviderView;
  settings: AppSettings;
};

// One provider: connection details, connection test and its models.
export function ProviderCard({ provider: p, settings }: Props) {
  const [names, setNames] = useState<string[]>([]);
  const [testing, startTest] = useTransition();

  // Doubles as connection test and model-name suggestions.
  function test() {
    startTest(async () => {
      const { data: found, error } = await fetchModelNames(p.id);
      if (!found) {
        toast.error(error);
        return;
      }

      setNames(found);
      toast.success(`Connected to ${p.name} · ${found.length} ${found.length === 1 ? "model" : "models"} available`);
    });
  }

  const addModel = (
    <ModelDialog
      providerId={p.id}
      suggestions={names}
      onLoadSuggestions={test}
      loadingSuggestions={testing}
      trigger={<Button variant="ghost" size="sm" />}
    >
      <Plus />
      Add model
    </ModelDialog>
  );

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            {p.name}
            <span className="rounded px-1.5 text-[11px] font-normal text-muted-foreground ring-1 ring-border">{KIND_LABELS[p.kind]}</span>
          </h3>
          <p className="flex items-center gap-2 truncate text-xs text-muted-foreground">
            <span className="truncate font-mono">{p.baseUrl ?? "Default endpoint"}</span>
            <span aria-hidden>·</span>
            <span className="flex shrink-0 items-center gap-1">
              <KeyRound className="size-3" />
              {p.hasKey ? "Key saved" : "No key"}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={test} disabled={testing}>
            {testing ? <Loader2 className="animate-spin" /> : <Plug />}
            Test connection
          </Button>
          <ProviderDialog provider={p} trigger={<Button variant="ghost" size="icon-sm" aria-label={`Edit ${p.name}`} className="text-muted-foreground" />}>
            <Pencil />
          </ProviderDialog>
          <ConfirmButton
            label={`Delete ${p.name}`}
            title={`Delete ${p.name}?`}
            description={`Its ${p.models.length} models are removed too. Projects using them fall back to the default model.`}
            onConfirm={removeProvider.bind(null, p.id)}
          />
        </div>
      </header>

      <ul className="divide-y border-t">
        {p.models.map((m) => (
          <ModelRow
            key={m.id}
            model={m}
            settings={settings}
            edit={
              <ModelDialog
                providerId={p.id}
                model={m}
                suggestions={names}
                onLoadSuggestions={test}
                loadingSuggestions={testing}
                trigger={<Button variant="ghost" size="icon-sm" aria-label={`Edit ${m.name}`} className="text-muted-foreground" />}
              >
                <Pencil />
              </ModelDialog>
            }
          />
        ))}
      </ul>

      <footer className="flex items-center gap-2 border-t bg-muted/30 px-2 py-1.5">
        {addModel}
        {p.models.length === 0 && <span className="text-xs text-muted-foreground">No models yet. Add the one you want reviews to use.</span>}
      </footer>
    </section>
  );
}

type RowProps = { model: Model; settings: AppSettings; edit: React.ReactNode };

function ModelRow({ model: m, settings, edit }: RowProps) {
  const [pending, startTransition] = useTransition();
  const isDefault = settings.defaultModelId === m.id;

  function makeDefault() {
    startTransition(async () => {
      const result = await saveSettings({ ...settings, defaultModelId: m.id });
      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(`${m.name} is the default model`);
    });
  }

  const facts = [
    `${Math.round(m.contextWindow / THOUSAND)}k context`,
    `${m.maxConcurrency} parallel`,
    m.inputCost != null && m.outputCost != null ? `$${m.inputCost} / $${m.outputCost} per 1M` : null,
    m.toolCalling ? null : "no tools",
    m.jsonSchema ? null : "no JSON schema",
  ].filter(Boolean);

  return (
    <li className="group/model flex items-center gap-3 px-4 py-2">
      <span className="min-w-0 truncate font-mono text-xs">{m.name}</span>
      {isDefault && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 text-[11px] font-medium text-primary">
          <Star className="size-3 fill-current" />
          Default
        </span>
      )}
      <span className="ml-auto hidden truncate text-xs text-muted-foreground sm:block">{facts.join(" · ")}</span>
      <div className="flex shrink-0 items-center gap-1">
        {!isDefault && (
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={makeDefault} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Make default
          </Button>
        )}
        {edit}
        <ConfirmButton
          label={`Delete ${m.name}`}
          title={`Delete ${m.name}?`}
          description="Projects using it fall back to the default model. Past reviews keep their results."
          onConfirm={removeModel.bind(null, m.id)}
        />
      </div>
    </li>
  );
}
