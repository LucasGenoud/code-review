"use client";

import { useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CategoryDot } from "@/components/category-badge";
import { SeverityBadge } from "@/components/severity-badge";
import { Scope } from "@/lib/domain";
import type { CategoryView } from "@/app/rules/actions";

// Picks a subset of rules: checkboxes grouped by category, a filter, and
// quick picks. Used to compose rule sets and to adjust one review's rules.
//
//   Name [Security audit]          Filter [injection      ]
//   [All] [None] [Switched on] [Reset]
//   ☑ ● Bugs                                  3/11
//     ☑ Injection: SQL, shell…           CRITICAL
//     ☐ Off-by-one…                 off     MAJOR
//   12 rules selected                    [Save]

export enum Naming {
  // Rule sets need a name.
  Required,
  // One review: a name also saves the pick as a rule set.
  Optional,
}

type Props = {
  title: string;
  description: string;
  categories: CategoryView[];
  // Selection when the dialog opens; Reset returns to it.
  initial: number[];
  naming: Naming;
  initialName?: string;
  submitLabel: string;
  // Returns an error to show, or null to close.
  onSubmit: (ruleIds: number[], name: string) => Promise<string | null>;
  trigger: React.ReactElement;
  children: React.ReactNode;
};

export function RuleComposer({ trigger, children, title, description, ...body }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger}>{children}</DialogTrigger>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {/* Mounted per open: state starts from `initial` each time. */}
        {open && <ComposerBody {...body} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

type BodyProps = Omit<Props, "trigger" | "children" | "title" | "description"> & { onDone: () => void };

function ComposerBody({ categories, initial, naming, initialName, submitLabel, onSubmit, onDone }: BodyProps) {
  const [name, setName] = useState(initialName ?? "");
  const [picked, setPicked] = useState(() => new Set(initial));
  const [filter, setFilter] = useState("");
  const [pending, startTransition] = useTransition();

  const allIds = categories.flatMap((c) => c.rules.map((r) => r.id));
  const onIds = categories.flatMap((c) => (c.enabled ? c.rules.filter((r) => r.enabled).map((r) => r.id) : []));

  function toggle(ids: number[], on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) {
          next.add(id);
          continue;
        }

        next.delete(id);
      }

      return next;
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // React bubbles through the dialog portal: keep a host form (e.g. New
    // review) from submitting too.
    e.stopPropagation();
    startTransition(async () => {
      const error = await onSubmit([...picked], name.trim());
      if (error) {
        toast.error(error);
        return;
      }

      onDone();
    });
  }

  // e.g. "sql" matches rule "Injection: SQL…" and every rule of a "SQL" category.
  const query = filter.trim().toLowerCase();
  const shown = categories
    .map((c) => ({
      ...c,
      rules: c.rules.filter((r) => !query || `${c.name} ${r.name} ${r.description}`.toLowerCase().includes(query)),
    }))
    .filter((c) => c.rules.length > 0);

  const quickPicks: { label: string; ids: number[] }[] = [
    { label: "All", ids: allIds },
    { label: "None", ids: [] },
    { label: "Switched on", ids: onIds },
    { label: "Reset", ids: initial },
  ];

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="composer-name">
            {naming === Naming.Required ? "Name" : "Save as rule set"}
            {naming === Naming.Optional && <span className="font-normal text-muted-foreground">(optional)</span>}
          </Label>
          <Input
            id="composer-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required={naming === Naming.Required}
            autoFocus={naming === Naming.Required}
            placeholder="e.g. Security audit"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="composer-filter">Filter rules</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="composer-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus={naming === Naming.Optional}
              placeholder="e.g. injection"
              className="pl-8"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick picks">
        {quickPicks.map((q) => (
          <Button key={q.label} type="button" size="xs" variant="outline" onClick={() => setPicked(new Set(q.ids))}>
            {q.label}
          </Button>
        ))}
      </div>

      <div className="max-h-[50vh] overflow-y-auto rounded-lg border">
        {shown.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">No rules match.</p>}
        {shown.map((c) => (
          <CategoryGroup key={c.id} category={c} picked={picked} onToggle={toggle} />
        ))}
      </div>

      <DialogFooter className="items-center">
        <span className="mr-auto text-sm text-muted-foreground tabular-nums">
          {picked.size} {picked.size === 1 ? "rule" : "rules"} selected
        </span>
        <Button type="submit" disabled={pending || picked.size === 0 || (naming === Naming.Required && !name.trim())}>
          {pending && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

type GroupProps = {
  category: CategoryView;
  picked: Set<number>;
  onToggle: (ids: number[], on: boolean) => void;
};

// One category: a checkbox for all its rules, then a row per rule.
// Switched-off rules are dimmed: picking them still reviews them.
function CategoryGroup({ category: c, picked, onToggle }: GroupProps) {
  const ids = c.rules.map((r) => r.id);
  const count = ids.filter((id) => picked.has(id)).length;
  const all = count === ids.length;

  return (
    <fieldset className="border-b last:border-b-0">
      <legend className="sr-only">{c.name}</legend>
      <label className="sticky top-0 z-10 flex cursor-pointer items-center gap-2 bg-muted px-3 py-2 text-sm font-medium">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={all}
          ref={(el) => {
            if (el) {
              el.indeterminate = count > 0 && !all;
            }
          }}
          onChange={() => onToggle(ids, !all)}
        />
        <CategoryDot color={c.color} />
        <span className={cn(!c.enabled && "text-muted-foreground")}>{c.name}</span>
        {!c.enabled && <span className="text-xs font-normal text-muted-foreground">off</span>}
        <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
          {count}/{ids.length}
        </span>
      </label>

      <ul>
        {c.rules.map((r) => {
          const off = !c.enabled || !r.enabled;
          return (
            <li key={r.id}>
              <label className="flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm hover:bg-muted/50">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={picked.has(r.id)}
                  onChange={(e) => onToggle([r.id], e.target.checked)}
                />
                <span className={cn("min-w-0 flex-1", off && "text-muted-foreground")}>
                  <span className="block">{r.name}</span>
                  {r.description !== r.name && <span className="block truncate text-xs text-muted-foreground">{r.description}</span>}
                </span>
                {r.scope === Scope.Project && <span className="shrink-0 text-[10px] text-muted-foreground uppercase">project</span>}
                {off && <span className="shrink-0 text-xs text-muted-foreground">off</span>}
                <SeverityBadge severity={r.severity} />
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
