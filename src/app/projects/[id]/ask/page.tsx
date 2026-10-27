import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { codebaseChatModel, getProject, listCodebaseThreads, loadCodebaseThread } from "@/app/actions";
import { AskView } from "./ask-view";

// Ask the codebase: read-only Q&A about the working tree, with a history
// of conversations. ?thread=12 opens one; none = a new conversation.
export default function AskPage({ params, searchParams }: PageProps<"/projects/[id]/ask">) {
  return (
    <main className="flex h-[calc(100dvh-3rem)] min-h-0 w-full">
      <Suspense fallback={<AskSkeleton />}>
        <Ask params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

type AskProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function Ask({ params, searchParams }: AskProps) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const { project } = await getProject(id).catch(() => notFound());
  const [threads, model] = await Promise.all([listCodebaseThreads(id), codebaseChatModel(id)]);
  if (!model) {
    return <NoModel projectId={id} />;
  }

  // An unknown or foreign id opens a new conversation instead.
  const requested = Number((await searchParams).thread);
  const threadId = threads.some((t) => t.id === requested) ? requested : null;
  const messages = threadId === null ? [] : await loadCodebaseThread(id, threadId);

  return (
    <AskView
      project={{ id, name: project.name }}
      model={model}
      initialThreads={threads}
      initialThreadId={threadId}
      initialMessages={messages}
    />
  );
}

function NoModel({ projectId }: { projectId: number }) {
  return (
    <Empty className="m-auto">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageSquare />
        </EmptyMedia>
        <EmptyTitle>No model configured</EmptyTitle>
        <EmptyDescription>Ask the codebase needs the project&apos;s model or a default model.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        <Button variant="outline" render={<Link href={`/projects/${projectId}`} />} nativeButton={false}>
          Back to project
        </Button>
        <Button render={<Link href="/settings" />} nativeButton={false}>
          Open settings
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function AskSkeleton() {
  return (
    <>
      <div className="hidden w-64 flex-col gap-2 border-r p-3 md:flex">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-6 w-2/3" />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mx-auto mt-auto h-20 w-full max-w-3xl" />
      </div>
    </>
  );
}
