"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { compactPaths, Expand, FileTree, type TreeFile } from "@/components/projects/file-tree";
import { RefCombobox, type RefOption } from "@/components/projects/ref-combobox";
import { timeAgo } from "@/components/projects/review-status";
import { DiffMode } from "@/lib/domain";
import { listCommits, listFiles, listRangeFiles, startReview, type ChangedFile, type CommitInfo, type ProjectRefs } from "@/app/actions";
import type { CategoryView, RuleSetView } from "@/app/rules/actions";
import { EMPTY_PASTE, PastedFiles, pastedFiles, type PasteState } from "./pasted-files";
import { choiceRuleIds, RulesPicker, type RulesChoice } from "./rules-picker";

const MODES: { mode: DiffMode; label: string; hint: string }[] = [
  { mode: DiffMode.Uncommitted, label: "Uncommitted", hint: "Working tree against HEAD, untracked files included." },
  { mode: DiffMode.LastCommit, label: "Last commit", hint: "What HEAD changed compared to its parent." },
  { mode: DiffMode.Commits, label: "Two commits", hint: "Everything that changed from the base commit to the head commit." },
  { mode: DiffMode.Branches, label: "Two branches", hint: "Like a pull request: head's changes since it forked from base." },
  { mode: DiffMode.Files, label: "Files", hint: "Whole files and folders of the working tree, reviewed as they are." },
  { mode: DiffMode.Pasted, label: "Paste", hint: "Code that isn't in the repository: drop files or paste text." },
];

// Branches tried in order as the default base.
const DEFAULT_BASES = ["main", "master", "origin/main", "origin/master"];

// Branch filter option for every branch. Ref names can't contain spaces: no clash.
const ALL_BRANCHES = "All branches";

type Range = { base: string | null; head: string | null };

// Modes that diff two commits; their changed files load once the range is set.
const RANGE_MODES = new Set([DiffMode.LastCommit, DiffMode.Commits, DiffMode.Branches]);

// Changed files of one range. key: the range they belong to, e.g. "branches|main|feature".
type RangeFiles = { key: string; files: TreeFile[] };

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
  // Changed files left out, per listing (uncommitted or one range); new
  // changes are picked by default.
  const [excluded, setExcluded] = useState<Record<string, Set<string>>>({});
  const [rangeFiles, setRangeFiles] = useState<RangeFiles | null>(null);
  const [loadingRange, startLoadingRange] = useTransition();
  // Working tree files for Files mode, loaded on first use.
  const [repoFiles, setRepoFiles] = useState<TreeFile[] | null>(null);
  const [picked, setPicked] = useState(() => new Set<string>());
  const [loadingFiles, startLoadingFiles] = useTransition();
  const [paste, setPaste] = useState<PasteState>(EMPTY_PASTE);


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
  const refsPicked = twoRefs ? range : { base: null, head: null };

  // Changed files to pick from: uncommitted, or the picked range once loaded.
  const rangeKey = RANGE_MODES.has(mode) && (!twoRefs || (range.base && range.head)) ? `${mode}|${range.base}|${range.head}` : null;
  const listKey = mode === DiffMode.Uncommitted ? mode : rangeKey;
  const changes: TreeFile[] | null =
    mode === DiffMode.Uncommitted ? refs.changes.map(treeFile) : rangeFiles?.key === rangeKey ? rangeFiles.files : null;
  const dropped = (listKey && excluded[listKey]) || new Set<string>();
  const kept = new Set((changes ?? []).map((f) => f.path).filter((p) => !dropped.has(p)));

  const incomplete =
    (twoRefs && (!range.base || !range.head)) ||
    (changes !== null && kept.size === 0) ||
    (rangeKey !== null && loadingRange) ||
    (mode === DiffMode.Files && picked.size === 0) ||
    (mode === DiffMode.Pasted && pastedFiles(paste).length === 0);

  // Load the changed files of a newly picked range.
  useEffect(() => {
    if (rangeKey === null) {
      return;
    }

    startLoadingRange(async () => {
      const result = await listRangeFiles(projectId, { mode, base: refsPicked.base, head: refsPicked.head, paths: null });
      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      setRangeFiles({ key: rangeKey, files: result.data.map(treeFile) });
    });
  }, [projectId, rangeKey, mode, refsPicked.base, refsPicked.head]);

  function pickMode(next: DiffMode) {
    setMode(next);
    if (next !== DiffMode.Files || repoFiles) {
      return;
    }

    startLoadingFiles(async () => {
      const result = await listFiles(projectId);
      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      setRepoFiles(result.data.map((path) => ({ path })));
    });
  }

  // Files and folders the review covers; null = all of the diff.
  function scope(): string[] | null {
    if (mode === DiffMode.Files) {
      return compactPaths(repoFiles ?? [], picked);
    }

    if (changes && kept.size < changes.length) {
      return compactPaths(changes, kept);
    }

    return null;
  }

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
      const source = { mode, ...refsPicked, paths: scope() };
      const pasted = mode === DiffMode.Pasted ? pastedFiles(paste) : [];
      const result = await startReview(projectId, source, choiceRuleIds(rules, ruleSets), pasted);
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
          onValueChange={(v) => v[0] && pickMode(v[0] as DiffMode)}
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


      {mode === DiffMode.Files &&
        (repoFiles === null || loadingFiles ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Loading files…
          </p>
        ) : (
          <FileTree label="Repository files" files={repoFiles} selected={picked} onChange={setPicked} expand={Expand.TopLevel} />
        ))}

      {mode === DiffMode.Pasted && <PastedFiles value={paste} onChange={setPaste} />}

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

      {listKey !== null &&
        (changes === null ? (
          loadingRange && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Loading changed files…
            </p>
          )
        ) : changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{mode === DiffMode.Uncommitted ? "No uncommitted changes." : "No changes in this range."}</p>
        ) : (
          <FileTree
            key={listKey}
            label="Changed files"
            files={changes}
            selected={kept}
            onChange={(next) => setExcluded((prev) => ({ ...prev, [listKey]: new Set(changes.map((f) => f.path).filter((p) => !next.has(p))) }))}
            expand={Expand.All}
          />
        ))}

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

// Changed file as a tree entry, tagged e.g. "M" for modified.
function treeFile(f: ChangedFile): TreeFile {
  return { path: f.path, tag: f.change[0], tagLabel: f.change };
}

// Default commit range: parent → tip.
function latestTwo(list: CommitInfo[]): Range {
  return { base: list[1]?.short ?? null, head: list[0]?.short ?? null };
}
