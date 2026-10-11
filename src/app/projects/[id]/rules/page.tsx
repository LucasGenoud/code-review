import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { ChangeList, LearnButton } from "@/components/rules/change-list";
import { RulesEditor, RulesSkeleton } from "@/components/rules/rules-editor";
import { getProject } from "@/app/actions";
import { listChanges, projectRules } from "@/app/rules/actions";

// Rules as one project sees them: global rules with this project's
// on/off and overrides, plus project-only rules and categories.
export default function ProjectRulesPage({ params }: PageProps<"/projects/[id]/rules">) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <Suspense fallback={<HeaderSkeleton />}>
        <ProjectRules params={params} />
      </Suspense>
    </main>
  );
}

async function ProjectRules({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const { project } = await getProject(id).catch(() => notFound());

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link href={`/projects/${id}`} className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground">
            ← {project.name}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Changes here apply to this project only. Edit a global rule to override it; reset to follow the global rule again.
          </p>
        </div>
        <LearnButton projectId={id} />
      </header>

      <Suspense fallback={null}>
        <Changes projectId={id} />
      </Suspense>

      <Suspense fallback={<RulesSkeleton />}>
        <Categories projectId={id} />
      </Suspense>
    </div>
  );
}

async function Changes({ projectId }: { projectId: number }) {
  return <ChangeList changes={await listChanges(projectId)} />;
}

async function Categories({ projectId }: { projectId: number }) {
  return <RulesEditor categories={await projectRules(projectId)} projectId={projectId} />;
}

function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-96" />
      </div>
      <RulesSkeleton />
    </div>
  );
}
