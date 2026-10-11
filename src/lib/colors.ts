import { Severity, type CategoryColor } from "./domain";

// Tailwind classes per category color. Full class names: Tailwind only
// generates classes it can find literally in the source.
export const CATEGORY_CLASSES: Record<CategoryColor, { dot: string; badge: string; border: string }> = {
  red: { dot: "bg-red-500", badge: "bg-red-500/10 text-red-700 dark:text-red-300 ring-red-500/25", border: "border-l-red-500" },
  orange: { dot: "bg-orange-500", badge: "bg-orange-500/10 text-orange-700 dark:text-orange-300 ring-orange-500/25", border: "border-l-orange-500" },
  amber: { dot: "bg-amber-500", badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/25", border: "border-l-amber-500" },
  green: { dot: "bg-green-500", badge: "bg-green-500/10 text-green-700 dark:text-green-300 ring-green-500/25", border: "border-l-green-500" },
  teal: { dot: "bg-teal-500", badge: "bg-teal-500/10 text-teal-700 dark:text-teal-300 ring-teal-500/25", border: "border-l-teal-500" },
  blue: { dot: "bg-blue-500", badge: "bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-blue-500/25", border: "border-l-blue-500" },
  violet: { dot: "bg-violet-500", badge: "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/25", border: "border-l-violet-500" },
  pink: { dot: "bg-pink-500", badge: "bg-pink-500/10 text-pink-700 dark:text-pink-300 ring-pink-500/25", border: "border-l-pink-500" },
  slate: { dot: "bg-slate-500", badge: "bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/25", border: "border-l-slate-500" },
};

export function categoryClasses(color: string) {
  return CATEGORY_CLASSES[color as CategoryColor] ?? CATEGORY_CLASSES.slate;
}

export const SEVERITY_CLASSES: Record<Severity, string> = {
  [Severity.Critical]: "bg-red-600 text-white",
  [Severity.Major]: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  [Severity.Minor]: "bg-yellow-500/15 text-yellow-800 dark:text-yellow-300",
  [Severity.Info]: "bg-muted text-muted-foreground",
};
