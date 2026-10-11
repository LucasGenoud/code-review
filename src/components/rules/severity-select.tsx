"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SeverityBadge } from "@/components/severity-badge";
import { SEVERITY_RANK, Severity } from "@/lib/domain";

// Highest first: critical, major, minor, info.
const SEVERITIES = Object.values(Severity).sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a]);

type Props = {
  value: Severity;
  onChange: (value: Severity) => void;
  // Accessible name, e.g. "Severity of rule R12".
  label: string;
  // Compact: badge-only trigger for rule rows.
  className?: string;
  size?: "sm" | "default";
};

// Severity picker that shows the colored badge as its value.
export function SeveritySelect({ value, onChange, label, className, size = "sm" }: Props) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as Severity)}>
      <SelectTrigger size={size} aria-label={label} className={className}>
        <SelectValue>{(v: Severity) => <SeverityBadge severity={v} />}</SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start">
        {SEVERITIES.map((s) => (
          <SelectItem key={s} value={s}>
            <SeverityBadge severity={s} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
