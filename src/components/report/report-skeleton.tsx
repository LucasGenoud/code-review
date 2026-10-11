import { Skeleton } from "@/components/ui/skeleton";

// Placeholder with the report's three-pane shape: no layout jump on load.

const FILE_ROWS = 6;
const FINDING_ROWS = 5;
const DIFF_LINES = 14;

export function ReportSkeleton() {
  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col" aria-busy aria-label="Loading review">
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <Skeleton className="size-7" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-3 w-80" />
        </div>
        <Skeleton className="ml-auto h-7 w-64" />
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_380px]">
        <div className="hidden flex-col gap-2 border-r p-3 lg:flex">
          {Array.from({ length: FILE_ROWS }, (_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>

        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="mt-2 h-8 w-full" />
          {Array.from({ length: DIFF_LINES }, (_, i) => (
            <Skeleton key={i} className="h-3.5" style={{ width: `${40 + ((i * 37) % 55)}%` }} />
          ))}
        </div>

        <div className="hidden flex-col gap-3 border-l p-3 xl:flex">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-6 w-2/3" />
          {Array.from({ length: FINDING_ROWS }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
