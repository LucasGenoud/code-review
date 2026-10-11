"use client";

import { useState, useTransition } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ProviderKind } from "@/lib/domain";
import { saveProvider, type ProviderView } from "@/app/settings/actions";

export const KIND_LABELS: Record<ProviderKind, string> = {
  [ProviderKind.OpenAI]: "OpenAI",
  [ProviderKind.Anthropic]: "Anthropic",
  [ProviderKind.Compatible]: "OpenAI-compatible",
};

const URL_PLACEHOLDERS: Record<ProviderKind, string> = {
  [ProviderKind.OpenAI]: "https://api.openai.com/v1 (default)",
  [ProviderKind.Anthropic]: "https://api.anthropic.com/v1 (default)",
  [ProviderKind.Compatible]: "http://localhost:8000/v1",
};

const KIND_ITEMS = Object.values(ProviderKind).map((k) => ({ value: k, label: KIND_LABELS[k] }));

// What happens to the stored API key on save.
enum KeyAction {
  Keep = "keep",
  Replace = "replace",
  Remove = "remove",
}

type Props = {
  // Edit this provider; absent = create.
  provider?: ProviderView;
  trigger: React.ReactElement;
  children: React.ReactNode;
};

// Create or edit an LLM provider. The stored key is never sent back:
// leave the field empty to keep it.
export function ProviderDialog({ provider, trigger, children }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState(ProviderKind.Compatible);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      return;
    }

    setName(provider?.name ?? "");
    setKind(provider?.kind ?? ProviderKind.Compatible);
    setBaseUrl(provider?.baseUrl ?? "");
    setApiKey("");
    setRemoveKey(false);
  }

  const keyAction = removeKey ? KeyAction.Remove : apiKey ? KeyAction.Replace : KeyAction.Keep;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const key = { [KeyAction.Keep]: undefined, [KeyAction.Replace]: apiKey, [KeyAction.Remove]: "" }[keyAction];
      const result = await saveProvider({ id: provider?.id, name, kind, baseUrl: baseUrl.trim() || null, apiKey: key });
      if (result.error) {
        toast.error(result.error);
        return;
      }

      setOpen(false);
      toast.success(provider ? "Provider saved" : `Added ${name}. Next: add a model.`);
    });
  }

  const compatible = kind === ProviderKind.Compatible;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger}>{children}</DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{provider ? `Edit ${provider.name}` : "Add provider"}</DialogTitle>
            <DialogDescription>An API that serves one or more models.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider-name">Name</Label>
              <Input id="provider-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Local vLLM" required autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider-kind">Kind</Label>
              <Select items={KIND_ITEMS} value={kind} onValueChange={(v) => v && setKind(v as ProviderKind)}>
                <SelectTrigger id="provider-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_ITEMS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-url">Base URL{compatible ? "" : " (optional)"}</Label>
            <Input
              id="provider-url"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={URL_PLACEHOLDERS[kind]}
              required={compatible}
              className="font-mono text-xs md:text-xs"
            />
            {compatible && (
              <p className="text-xs text-muted-foreground">
                Running in Docker? Reach a server on your machine with <code className="font-mono">host.docker.internal</code> instead of
                localhost.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-key">API key</Label>
            <Input
              id="provider-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setRemoveKey(false);
              }}
              disabled={removeKey}
              placeholder={provider?.hasKey ? "Key saved · leave empty to keep" : compatible ? "Optional for local servers" : "sk-…"}
            />
            {provider?.hasKey && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <KeyRound className="size-3.5" />
                {removeKey ? "Key will be removed on save." : "A key is saved. It is never shown again."}
                <Button type="button" variant="link" size="xs" className="ml-auto h-auto p-0" onClick={() => setRemoveKey(!removeKey)}>
                  {removeKey ? "Keep key" : "Remove key"}
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {provider ? "Save" : "Add provider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
