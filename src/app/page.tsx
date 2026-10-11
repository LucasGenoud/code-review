import { Suspense } from "react";
import Link from "next/link";
import { ChevronRight, FolderGit2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { AddProjectDialog } from "@/components/add-project-dialog";
import { ConfirmButton } from "@/components/projects/confirm-button";
import { ReviewStatusBadge, timeAgo } from "@/components/projects/review-status";
import { listProjects, listReviews, removeProject, type Project } from "./actions";

const SKELETON_ROWS = 3;

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">Local git repositories you review.</p>
        </div>
        <AddProjectDialog />
      </header>

      <Suspense fallback={<ListSkeleton />}>
        <ProjectList />
      </Suspense>
    </main>
  );
}

async function ProjectList() {
  const projects = await listProjects();

  if (projects.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderGit2 />
          </EmptyMedia>
          <EmptyTitle>No projects yet</EmptyTitle>
          <EmptyDescription>Add a git repository to review its uncommitted changes, commits or branches.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <AddProjectDialog />
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {projects.map((p) => (
        <ProjectRow key={p.id} project={p} />
      ))}
    </ul>
  );
}

// One project: whole row links to the project; delete sits above the link.
async function ProjectRow({ project }: { project: Project }) {
  const [last] = await listReviews(project.id);

  return (
    <li className="group relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
      <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <Link
          href={`/projects/${project.id}`}
          className="font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
        >
          {project.name}
        </Link>
        <p className="truncate font-mono text-xs text-muted-foreground">{project.path}</p>
      </div>

      <div className="hidden shrink-0 items-center gap-2 text-xs text-muted-foreground sm:flex">
        {last ? (
          <>
            <ReviewStatusBadge status={last.status} />
            <span className="max-w-48 truncate">{last.rangeLabel}</span>
            <span aria-hidden>·</span>
            <span>{timeAgo(last.createdAt)}</span>
          </>
        ) : (
          <span>No reviews yet</span>
        )}
      </div>

      <div className="relative z-10">
        <ConfirmButton
          label={`Remove ${project.name}`}
          title={`Remove ${project.name}?`}
          description="Its reviews and project rules are deleted. Files on disk are untouched."
          confirmLabel="Remove"
          onConfirm={removeProject.bind(null, project.id)}
        />
      </div>

      <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" aria-hidden />
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="divide-y rounded-xl border">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-4" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
      ))}
    </div>
  );
}
