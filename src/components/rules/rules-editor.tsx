import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryDot } from "@/components/category-badge";
import { Scope } from "@/lib/domain";
import type { CategoryView } from "@/app/rules/actions";
import { CategoryCard } from "./category-card";
import { CategoryDialog } from "./category-dialog";

const SKELETON_CARDS = 3;

type Props = {
  categories: CategoryView[];
  // Null on the global page.
  projectId: number | null;
};

// Category list with a jump nav:
//   ┌ nav ──────┐ ┌ category card ─────────────┐
//   │ ● Bugs  4 │ │ header: badge, on/off, ... │
//   │ ● Python 9│ │ rules                      │
//   └───────────┘ └────────────────────────────┘
export function RulesEditor({ categories, projectId }: Props) {
  const newLabel = projectId === null ? "New category" : "New project category";

  return (
    <div className="grid gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
      <nav aria-label="Categories" className="hidden lg:block">
        <ul className="sticky top-16 flex flex-col gap-0.5 text-sm">
          {categories.map((c) => (
            <li key={c.id}>
              <a
                href={`#category-${c.id}`}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <CategoryDot color={c.color} />
                <span className={c.enabled ? "truncate" : "truncate line-through opacity-60"}>{c.name}</span>
                {c.scope === Scope.Project && <span className="text-[10px] uppercase">proj</span>}
                <span className="ml-auto text-xs tabular-nums">{c.rules.length}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-col gap-4">
        {categories.map((c) => (
          <CategoryCard key={c.id} category={c} projectId={projectId} />
        ))}

        <CategoryDialog projectId={projectId} trigger={<Button variant="outline" className="self-start border-dashed" />}>
          <Plus />
          {newLabel}
        </CategoryDialog>
      </div>
    </div>
  );
}

export function RulesSkeleton() {
  return (
    <div className="flex flex-col gap-4 lg:pl-54">
      {Array.from({ length: SKELETON_CARDS }, (_, i) => (
        <Skeleton key={i} className="h-40 w-full rounded-xl" />
      ))}
    </div>
  );
}
