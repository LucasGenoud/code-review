"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ModelOption = { id: number; label: string };

type Props = {
  id?: string;
  models: ModelOption[];
  value: number | null;
  onChange: (value: number | null) => void;
  // Label of the null choice, e.g. "Default model" or "None".
  nullLabel: string;
  className?: string;
};

// Select values are strings; this one stands for null.
const NONE = "none";

// Picks a configured model as "Provider / model", or null.
export function ModelSelect({ id, models, value, onChange, nullLabel, className }: Props) {
  const items = [{ value: NONE, label: nullLabel }, ...models.map((m) => ({ value: String(m.id), label: m.label }))];

  return (
    <Select
      items={items}
      value={value === null ? NONE : String(value)}
      onValueChange={(v) => onChange(v === NONE || v === null ? null : Number(v))}
    >
      <SelectTrigger id={id} className={className ?? "w-full"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
