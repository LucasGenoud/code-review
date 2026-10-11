"use client";

import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "cn";

export type RefOption = { value: string; label: string; hint?: string };

type Props = {
  id: string;
  options: RefOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder: string;
  className?: string;
};

// Filterable picker for a git ref (branch or commit). Type to filter by
// label, e.g. "a1b2c3" or "fix login".
export function RefCombobox({ id, options, value, onChange, placeholder, className }: Props) {
  const labels = new Map(options.map((o) => [o.value, o.label]));

  return (
    <Combobox.Root
      items={options.map((o) => o.value)}
      value={value}
      onValueChange={onChange}
      itemToStringLabel={(v: string) => labels.get(v) ?? v}
    >
      <Combobox.InputGroup
        className={cn(
          "relative flex h-8 w-full min-w-0 items-center rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
          className,
        )}
      >
        <Combobox.Input
          id={id}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 truncate bg-transparent pr-8 pl-2.5 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Combobox.Trigger
          aria-label="Show options"
          className="absolute right-1 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <ChevronsUpDown className="size-3.5" />
        </Combobox.Trigger>
      </Combobox.InputGroup>

      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} align="start" className="isolate z-50">
          <Combobox.Popup className="w-(--anchor-width) min-w-72 max-w-(--available-width) origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
            <Combobox.Empty className="px-3 py-2 text-sm text-muted-foreground empty:hidden">No matches.</Combobox.Empty>
            <Combobox.List className="max-h-[min(20rem,var(--available-height))] overflow-y-auto overscroll-contain p-1 data-empty:p-0">
              {(v: string) => <RefItem key={v} option={options.find((o) => o.value === v)!} />}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

function RefItem({ option }: { option: RefOption }) {
  return (
    <Combobox.Item
      value={option.value}
      className="grid cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-md px-1.5 py-1 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
    >
      <Combobox.ItemIndicator className="col-start-1">
        <Check className="size-3.5" />
      </Combobox.ItemIndicator>
      <span className="col-start-2 flex min-w-0 items-baseline gap-2">
        <span className="truncate">{option.label}</span>
        {option.hint && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{option.hint}</span>}
      </span>
    </Combobox.Item>
  );
}
