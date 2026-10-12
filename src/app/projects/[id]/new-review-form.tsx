"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { RefCombobox, type RefOption } from "@/components/projects/ref-combobox";
import { timeAgo } from "@/components/projects/review-status";
import { DiffMode } from "@/lib/domain";
import { listCommits, startReview, type ChangedFile, type CommitInfo, type ProjectRefs } from "@/app/actions";
import type { CategoryView, RuleSetView } from "@/app/rules/actions";
import { choiceRuleIds, RulesPicker, type RulesChoice } from "./rules-picker";

const MODES: { mode: DiffMode; label: string; hint: string }[] = [
  { mode: DiffMode.Uncommitted, label: "Uncommitted changes", hint: "Working tree against HEAD, untracked files included." },
  { mode: DiffMode.LastCommit, label: "Last commit", hint: "What HEAD changed compared to its parent." },
  { mode: DiffMode.Commits, label: "Two commits", hint: "Everything that changed from the base commit to the head commit." },
  { mode: DiffMode.Branches, label: "Two branches", hint: "Like a pull request: head's changes since it forked from base." },
];

// Branches tried in order as the default base.
const DEFAULT_BASES = ["main", "master", "origin/main", "origin/master"];

// Branch filter option for every branch. Ref names can't contain spaces: no clash.
const ALL_BRANCHES = "All branches";

type Range = { base: string | null; head: string | null };

type Props = {
  projectId: number;
  refs: ProjectRefs;
  ruleSets: RuleSetView[];
  // The project's rules, for customizing one review's rules.
  categories: CategoryView[];
  defaultSetId: number | null;
  // Why reviews can't start, e.g. no model configured. Null = ready.
  blocker: string | null;
};

// Picks what to diff and starts a review, then opens its report.
export function NewReviewForm({ projectId, refs, ruleSets, categories, defaultSetId, blocker }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [loadingCommits, startLoadingCommits] = useTransition();
  const [mode, setMode] = useState(DiffMode.Uncommitted);
  const [branchFilter, setBranchFilter] = useState(ALL_BRANCHES);
  const [commitList, setCommitList] = useState(refs.commits);
  const [rules, setRules] = useState<RulesChoice>({ setId: defaultSetId, custom: null });

  const commitOptions: RefOption[] = commitList.map((c) => ({
    value: c.short,
    label: `${c.short}  ${c.subject}`,
    hint: `${timeAgo(new Date(c.date))} · ${c.author}`,
  }));
  const branchOptions: RefOption[] = refs.branches.map((b) => ({ value: b, label: b, hint: b === refs.current ? "current" : undefined }));
  const filterOptions: RefOption[] = [{ value: ALL_BRANCHES, label: ALL_BRANCHES }, ...branchOptions];

  const [commits, setCommits] = useState<Range>(latestTwo(refs.commits));
  const [branches, setBranches] = useState<Range>({
    base: DEFAULT_BASES.find((b) => refs.branches.includes(b)) ?? null,
    head: refs.current,
  });

  const twoRefs = mode === DiffMode.Commits || mode === DiffMode.Branches;
  const range = mode === DiffMode.Commits ? commits : branches;
  const setRange = mode === DiffMode.Commits ? setCommits : setBranches;
  const options = mode === DiffMode.Commits ? commitOptions : branchOptions;
  const incomplete = twoRefs && (!range.base || !range.head);

  // Reload the commit pickers for the chosen branch; picks reset to its tip.
  function filterBranch(value: string | null) {
    const branch = value ?? ALL_BRANCHES;
    setBranchFilter(branch);
    startLoadingCommits(async () => {
      const result = await listCommits(projectId, branch === ALL_BRANCHES ? null : branch);
      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      setCommitList(result.data);
      setCommits(latestTwo(result.data));
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const source = twoRefs ? { mode, ...range } : { mode, base: null, head: null };
      const result = await startReview(projectId, source, choiceRuleIds(rules, ruleSets));
      if (result.error) {
        toast.error(result.error);
        return;
      }

      router.push(`/reviews/${result.data}`);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <ToggleGroup
          aria-label="What to review"
          value={[mode]}
          onValueChange={(v) => v[0] && setMode(v[0] as DiffMode)}
          spacing={0}
          className="w-full flex-wrap rounded-lg bg-muted p-0.5"
        >
          {MODES.map((m) => (
            <ToggleGroupItem
              key={m.mode}
              value={m.mode}
              size="sm"
              className="flex-1 text-muted-foreground data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-sm group-data-[spacing=0]/toggle-group:rounded-md hover:bg-transparent"
            >
              {m.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">{MODES.find((m) => m.mode === mode)?.hint}</p>
      </div>

      {mode === DiffMode.Uncommitted && <ChangedFiles files={refs.changes} />}

      {mode === DiffMode.Commits && (
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="ref-branch" className="text-xs text-muted-foreground">
            Branch
            {loadingCommits && <Loader2 className="size-3 animate-spin" aria-label="Loading commits" />}
          </Label>
          <RefCombobox id="ref-branch" options={filterOptions} value={branchFilter} onChange={filterBranch} placeholder={ALL_BRANCHES} />
        </div>
      )}

      {twoRefs && (
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="ref-base" className="text-xs text-muted-foreground">Base</Label>
            <RefCombobox
              id="ref-base"
              options={options}
              value={range.base}
              onChange={(base) => setRange((r: Range) => ({ ...r, base }))}
              placeholder={mode === DiffMode.Commits ? "Older commit" : "e.g. main"}
            />
          </div>
          <ArrowRight className="mb-2 size-4 text-muted-foreground" aria-hidden />
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="ref-head" className="text-xs text-muted-foreground">Head</Label>
            <RefCombobox
              id="ref-head"
              options={options}
              value={range.head}
              onChange={(head) => setRange((r: Range) => ({ ...r, head }))}
              placeholder={mode === DiffMode.Commits ? "Newer commit" : "e.g. feature"}
            />
          </div>
        </div>
      )}

      <RulesPicker value={rules} onChange={setRules} ruleSets={ruleSets} categories={categories} defaultSetId={defaultSetId} />

      <div className="flex flex-wrap items-center justify-end gap-3">
        {blocker && <p className="mr-auto text-xs text-muted-foreground">{blocker}</p>}
        <Button type="submit" disabled={pending || incomplete || blocker !== null}>
          {pending ? <Loader2 className="animate-spin" /> : <Play />}
          Start review
        </Button>
      </div>
    </form>
  );
}

// Default commit range: parent → tip.
function latestTwo(list: CommitInfo[]): Range {
  return { base: list[1]?.short ?? null, head: list[0]?.short ?? null };
}

// Files the review will read, e.g. "M src/app.ts", "A notes.md".
function ChangedFiles({ files }: { files: ChangedFile[] }) {
  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground">No uncommitted changes.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">
        {files.length} changed {files.length === 1 ? "file" : "files"}
      </p>
      <ul className="max-h-48 overflow-y-auto rounded-lg border px-2.5 py-1.5 font-mono text-xs">
        {files.map((f) => (
          <li key={f.path} className="flex gap-2 py-0.5" title={`${f.change}: ${f.path}`}>
            <span className="w-3 shrink-0 text-muted-foreground uppercase" aria-label={f.change}>
              {f.change[0]}
            </span>
            <span className="min-w-0 truncate">{f.path}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
