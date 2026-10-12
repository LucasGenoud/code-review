import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle, ChevronRight, History, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { AutoRefresh } from "@/components/projects/auto-refresh";
import { ConfirmButton } from "@/components/projects/confirm-button";
import { formatCost, ReviewStatusBadge, timeAgo } from "@/components/projects/review-status";
import { ReviewStatus } from "@/lib/domain";
import { getProject, listReviews, projectLanguages, projectRefs, type ReviewSummary } from "@/app/actions";
import { removeReview } from "@/app/reviews/actions";
import { listRuleSets, projectRules } from "@/app/rules/actions";
import { getSettings, listModelOptions } from "@/app/settings/actions";
import { DescriptionPanel } from "./description-panel";
import { LanguagesPanel } from "./languages-panel";
import { NewReviewForm } from "./new-review-form";
import { SettingsPanel } from "./settings-panel";

// Project home:
//   ┌ header: name, path, Rules ───────────────────────────┐
//   │ New review (primary)          │ Description          │
//   │ Review history                │ Languages, Settings  │
//   └───────────────────────────────┴──────────────────────┘
export default function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <Suspense fallback={<PageSkeleton />}>
        <ProjectView params={params} />
      </Suspense>
    </main>
  );
}

async function ProjectView({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const { project, describing } = await getProject(id).catch(() => notFound());
  const [models, settings, ruleSets] = await Promise.all([listModelOptions(), getSettings(), listRuleSets()]);

  // Reviews need the project's model or the global default.
  const noModel = models.length === 0 || (project.modelId === null && settings.defaultModelId === null);
  const blocker = noModel ? "Configure a model to start reviews." : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/" className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground">
            ← Projects
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <p className="truncate font-mono text-xs text-muted-foreground">{project.path}</p>
        </div>
        <Button variant="outline" render={<Link href={`/projects/${id}/rules`} />} nativeButton={false}>
          <ListChecks />
          Rules
        </Button>
      </header>

      {noModel && <NoModelCallout hasModels={models.length > 0} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader><CardTitle><h2>New review</h2></CardTitle></CardHeader>
            <CardContent>
              <Suspense fallback={<Skeleton className="h-28 w-full" />}>
                <NewReview projectId={id} defaultSetId={project.ruleSetId} blocker={blocker} />
              </Suspense>
            </CardContent>
          </Card>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Review history</h2>
            <Suspense fallback={<Skeleton className="h-32 w-full" />}>
              <ReviewHistory projectId={id} />
            </Suspense>
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <DescriptionPanel project={project} describing={describing} />
          <Suspense fallback={<Skeleton className="h-40 w-full" />}>
            <Languages projectId={id} />
          </Suspense>
          <SettingsPanel project={project} models={models} ruleSets={ruleSets} />
        </aside>
      </div>
    </div>
  );
}

function NoModelCallout({ hasModels }: { hasModels: boolean }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
      <AlertCircle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="flex-1">
        {hasModels
          ? "No model selected. Pick one in this project's settings or set a default model."
          : "No LLM configured yet. Add a provider and a model to start reviewing."}
      </p>
      <Button size="sm" variant="outline" render={<Link href="/settings" />} nativeButton={false}>
        Open settings
      </Button>
    </div>
  );
}

type NewReviewProps = { projectId: number; defaultSetId: number | null; blocker: string | null };

async function NewReview({ projectId, defaultSetId, blocker }: NewReviewProps) {
  const [refs, ruleSets, categories] = await Promise.all([projectRefs(projectId), listRuleSets(), projectRules(projectId)]);
  return (
    // Remount on a new project default so the picker starts from it.
    <NewReviewForm
      key={defaultSetId ?? "switched-on"}
      projectId={projectId}
      refs={refs}
      ruleSets={ruleSets}
      categories={categories}
      defaultSetId={defaultSetId}
      blocker={blocker}
    />
  );
}

async function Languages({ projectId }: { projectId: number }) {
  return <LanguagesPanel projectId={projectId} languages={await projectLanguages(projectId)} />;
}

async function ReviewHistory({ projectId }: { projectId: number }) {
  const reviews = await listReviews(projectId);

  if (reviews.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <History />
          </EmptyMedia>
          <EmptyTitle>No reviews yet</EmptyTitle>
          <EmptyDescription>Pick what to review above and start your first review.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {reviews.some((r) => r.status === ReviewStatus.Running) && <AutoRefresh />}
      {reviews.map((r) => (
        <ReviewRow key={r.id} review={r} />
      ))}
    </ul>
  );
}

// One review; the row links to its report, delete sits above the link.
function ReviewRow({ review: r }: { review: ReviewSummary }) {
  const findings = `${r.findingCount} open ${r.findingCount === 1 ? "finding" : "findings"}`;

  return (
    <li className="relative flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50">
      <ReviewStatusBadge status={r.status} className="w-20" />

      <div className="min-w-0 flex-1">
        <Link
          href={`/reviews/${r.id}`}
          className="block truncate text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
        >
          {r.rangeLabel}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {r.modelLabel}
          {r.cost !== null && ` · ${formatCost(r.cost)}`}
          {` · ${timeAgo(r.createdAt)}`}
        </p>
      </div>

      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {r.status === ReviewStatus.Running ? "…" : findings}
      </span>

      <div className="relative z-10">
        <ConfirmButton
          label={`Delete review #${r.id}`}
          title="Delete this review?"
          description={`${r.rangeLabel}, ${timeAgo(r.createdAt)}. Its findings and chat are deleted.`}
          onConfirm={removeReview.bind(null, r.id)}
        />
      </div>

      <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" aria-hidden />
    </li>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3 w-80" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
