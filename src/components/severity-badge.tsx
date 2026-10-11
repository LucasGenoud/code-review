import { cn } from "cn";
import { SEVERITY_CLASSES } from "@/lib/colors";
import type { Severity } from "@/lib/domain";

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-semibold uppercase tracking-wide",
        SEVERITY_CLASSES[severity],
        className,
      )}
    >
      {severity}
    </span>
  );
}
