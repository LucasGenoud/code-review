import { Suspense } from "react";
import { Check, Plus } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProviderCard } from "@/components/settings/provider-card";
import { ProviderDialog } from "@/components/settings/provider-dialog";
import { PromptsSection } from "@/components/settings/prompts-section";
import { ReviewSettingsForm } from "@/components/settings/review-settings-form";
import { SandboxSection } from "@/components/settings/sandbox-section";
import { getSandboxStatus, getSettings, listModelOptions, listPrompts, listProviders } from "./actions";

// Settings:
//   setup steps (until a default model exists)
//   providers ─< models
//   review settings, prompts, code sandbox
export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm leading-6 text-muted-foreground">LLM providers and models, and how reviews run.</p>
      </header>

      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsView />
      </Suspense>
    </main>
  );
}

async function SettingsView() {
  const [providers, settings, models, sandbox, prompts] = await Promise.all([
    listProviders(),
    getSettings(),
    listModelOptions(),
    getSandboxStatus(),
    listPrompts(),
  ]);

  const steps = [
    { label: "Add a provider", hint: "OpenAI, Anthropic or any OpenAI-compatible server.", done: providers.length > 0 },
    { label: "Add a model", hint: "Test the connection to pick from the provider's models.", done: models.length > 0 },
    { label: "Set a default model", hint: "Click Make default on a model.", done: models.some((m) => m.id === settings.defaultModelId) },
  ];

  const addProvider = (
    <ProviderDialog trigger={<Button variant={providers.length ? "outline" : "default"} size="sm" />}>
      <Plus />
      Add provider
    </ProviderDialog>
  );

  return (
    <div className="flex flex-col gap-10">
      {steps.some((s) => !s.done) && <SetupSteps steps={steps} />}

      <Section title="Providers & models" action={providers.length > 0 && addProvider}>
        {providers.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center">
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              No providers yet. Add the API that serves your model: a cloud API or a local server like vLLM, Ollama or LM Studio.
            </p>
            {addProvider}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {providers.map((p) => (
              <ProviderCard key={p.id} provider={p} settings={settings} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Review settings">
        <ReviewSettingsForm key={JSON.stringify(settings)} settings={settings} models={models} />
      </Section>

      <Section title="Prompts">
        <PromptsSection prompts={prompts} />
      </Section>

      <Section title="Code sandbox">
        <SandboxSection key={JSON.stringify(sandbox)} status={sandbox} />
      </Section>
    </div>
  );
}

type Step = { label: string; hint: string; done: boolean };

// First-run checklist: provider → model → default.
function SetupSteps({ steps }: { steps: Step[] }) {
  return (
    <section aria-label="Setup" className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium">Get started in 3 steps</h2>
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.label} className="flex gap-3">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                s.done ? "bg-green-500/15 text-green-700 dark:text-green-400" : "bg-muted text-muted-foreground",
              )}
            >
              {s.done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <div>
              <p className={cn("text-sm", s.done && "text-muted-foreground line-through")}>{s.label}</p>
              <p className="text-xs text-muted-foreground">{s.hint}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}
