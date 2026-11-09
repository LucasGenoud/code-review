"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchModelNames, saveEmbeddingSettings, type EmbeddingSettings } from "@/app/settings/actions";
import { ModelSelect, type ModelOption } from "./model-select";

// Embedding model of semantic search: provider, model id, and the prefix
// instruction-aware models expect on queries. Saving tests the model with
// one call. Indexes are built per project, on its page.
//
//   Provider [Local vLLM ▾]  Model [harrier-oss-v1-0.6b] [Load]
//   Query instruction [Instruct: …\nQuery: ]  presets: Instruct · nomic · None
//   [Save and test]

// Model ids that look like embedding models, listed first.
const EMBEDDING_NAME = /embed|harrier|bge|e5|gte|minilm|nomic|jina/i;

const PRESETS = [
  { label: "Instruct (Harrier, Qwen3, E5)", prefix: "Instruct: Given a question about a codebase, retrieve the code that answers it\nQuery: " },
  { label: "nomic", prefix: "search_query: " },
  { label: "None", prefix: "" },
];

export function EmbeddingSection({ settings, providers }: { settings: EmbeddingSettings; providers: ModelOption[] }) {
  const [providerId, setProviderId] = useState(settings.providerId);
  const [model, setModel] = useState(settings.model);
  const [queryPrefix, setQueryPrefix] = useState(settings.queryPrefix);
  const [names, setNames] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [loading, startLoading] = useTransition();

  const dirty = providerId !== settings.providerId || model !== settings.model || queryPrefix !== settings.queryPrefix;

  function save() {
    startTransition(async () => {
      const result = await saveEmbeddingSettings({ providerId, model, queryPrefix });
      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(result.data === null ? "Semantic search turned off" : `Embedding model works: ${result.data}-dimension vectors`);
    });
  }

  function loadNames() {
    if (providerId === null) {
      return;
    }

    startLoading(async () => {
      const { data: found, error } = await fetchModelNames(providerId);
      if (!found) {
        toast.error(error);
        return;
      }

      // Embedding models first: chat models share the list.
      setNames([...new Set([...found.filter((n) => EMBEDDING_NAME.test(n)), ...found])]);
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">
        Lets the chat find code by meaning, not only by words: &ldquo;command palette&rdquo; finds the quick access code. Needs an
        OpenAI or OpenAI-compatible embeddings endpoint (OpenAI, vLLM, TEI, Ollama, LM Studio). Build the index on each project&apos;s
        page; changing the model needs a rebuild.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="embedding-provider">Provider</Label>
          <ModelSelect id="embedding-provider" models={providers} value={providerId} onChange={setProviderId} nullLabel="Off" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="embedding-model">Embedding model</Label>
          <div className="flex gap-2">
            <Input
              id="embedding-model"
              list="embedding-models"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. text-embedding-3-small"
              disabled={providerId === null}
            />
            <Button type="button" variant="outline" size="sm" onClick={loadNames} disabled={providerId === null || loading} title="Load the provider's models">
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Load
            </Button>
          </div>
          <datalist id="embedding-models">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="embedding-prefix">Query instruction</Label>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setQueryPrefix(p.prefix)}
                disabled={providerId === null}
                className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <Textarea
          id="embedding-prefix"
          value={queryPrefix}
          onChange={(e) => setQueryPrefix(e.target.value)}
          rows={2}
          className="font-mono text-xs"
          placeholder="Empty for OpenAI models. Instruction-aware models need one, e.g. Instruct: …"
          disabled={providerId === null}
        />
        <p className="text-xs text-muted-foreground">Added before search queries only, never before code. Changing it needs no rebuild.</p>
      </div>

      <div>
        <Button size="sm" onClick={save} disabled={!dirty || pending || (providerId !== null && !model.trim())}>
          {pending && <Loader2 className="animate-spin" />}
          {providerId === null ? "Save" : "Save and test"}
        </Button>
      </div>
    </div>
  );
}
