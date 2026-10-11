import { cn } from "cn";
import { categoryClasses } from "@/lib/colors";

// Colored tag for a rule category, e.g. ● Bugs.
export function CategoryBadge({ name, color, className }: { name: string; color: string; className?: string }) {
  const c = categoryClasses(color);
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium ring-1 ring-inset",
        c.badge,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", c.dot)} aria-hidden />
      {name}
    </span>
  );
}

// Just the color dot, for dense lists.
export function CategoryDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", categoryClasses(color).dot, className)} aria-hidden />;
}
