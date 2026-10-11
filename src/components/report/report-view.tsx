"use client";

import { useEffect, useEffectEvent, useOptimistic, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import type { UIMessage } from "ai";
import { ChevronRight, FileX2 } from "lucide-react";
import { toast } from "sonner";
import {
  applyFix,
  dismissFinding,
  refreshReview,
  reopenFinding,
  undoFix,
  type Finding,
  type Report,
} from "@/app/reviews/actions";
import { ReviewChat, type ChatHandle } from "@/components/chat/review-chat";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { FindingStatus, ReviewStatus } from "@/lib/domain";
import { FileDiff } from "./file-diff";
import { FileList } from "./file-list";
import { FindingsPanel } from "./findings-panel";
import { ReportContext } from "./report-context";
import { ReportHeader } from "./report-header";
import { DEFAULT_FILTERS, findingAnchor, listAnchor, matchesScope, matchesStatus, sortFindings } from "./report-lib";
import { ShortcutsDialog } from "./shortcuts-dialog";

// Review report: header, file list | diffs with inline findings | findings
// panel, plus the chat sheet. Owns filters, selection, optimistic finding
// statuses, polling while the review runs, and keyboard shortcuts.
//
//   ┌──────────────── header: meta, progress, actions ───────────────┐
//   │ files (lg+) │ overview + diffs, cards inline │ findings (xl+)  │
//   └─────────────┴─────────────────────────────────┴─────────────────┘

const POLL_MS = 1500;
const FLASH_MS = 1600;
// Sheet exit transition is 200 ms.
const SHEET_CLOSE_MS = 250;

enum Step {
  Next = 1,
  Prev = -1,
}

type Patch = { id: number; status: FindingStatus; dismissReason?: string | null };

type Props = {
  report: Report;
  chat: UIMessage[];
  // Sandbox runner enabled and online: bug findings can be verified.
  canVerify: boolean;
};

export function ReportView({ report, chat, canVerify }: Props) {
  const router = useRouter();
  const reviewId = report.review.id;
  const running = report.running || report.review.status === ReviewStatus.Running;
  const theme = useDiffTheme();

  // Lookups from the rules snapshot the review ran with.
  const categories = new Map(report.rules.categories.map((c) => [c.id, c]));
  const rules = new Map(report.rules.categories.flatMap((c) => c.rules.map((r) => [r.id, `${r.name}: ${r.description}`] as const)));

  // Optimistic statuses and in-flight markers; server data wins after refresh.
  const [findings, patchFinding] = useOptimistic(report.findings, (state, p: Patch) =>
    state.map((f) => (f.id === p.id ? { ...f, ...p } : f)),
  );
  const [busy, markBusy] = useOptimistic<number[], number>([], (state, id) => [...state, id]);
  const [, startTransition] = useTransition();
  const [refreshing, startRefresh] = useTransition();

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [dismissingId, setDismissingId] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const chatRef = useRef<ChatHandle>(null);

  // Diff shows every status (closed ones collapsed); the panel filters status.
  const scoped = findings.filter((f) => matchesScope(f, filters, categories));
  const listed = sortFindings(
    scoped.filter((f) => matchesStatus(f, filters.status)),
    categories,
  );
  const openCount = findings.filter((f) => f.status === FindingStatus.Open).length;

  // Poll server data while the review runs: findings appear progressively.
  useEffect(() => {
    if (!running) {
      return;
    }

    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, router]);

  // End the highlight pulse.
  useEffect(() => {
    if (flashId === null) {
      return;
    }

    const timer = setTimeout(() => setFlashId(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashId]);

  // Optimistic finding mutation; the action refreshes server data.
  function mutate(patch: Patch, action: () => Promise<{ error?: string }>, success?: string) {
    startTransition(async () => {
      markBusy(patch.id);
      patchFinding(patch);
      const result = await action();
      if (result.error) {
        toast.error(result.error);
        return;
      }

      if (success) {
        toast.success(success);
      }
    });
  }

  function apply(id: number) {
    const f = findings.find((x) => x.id === id);
    mutate({ id, status: FindingStatus.Fixed }, () => applyFix(id), f && `Fix applied to ${f.path}`);
  }

  // Undo restores the file on the server; refresh supplies restored locations.
  function undo(id: number) {
    const f = findings.find((x) => x.id === id);
    mutate({ id, status: FindingStatus.Open }, () => undoFix(id), f && `Fix undone in ${f.path}`);
  }

  function dismiss(id: number, reason: string) {
    mutate({ id, status: FindingStatus.Dismissed, dismissReason: reason.trim() || null }, () => dismissFinding(id, reason));
  }

  function reopen(id: number) {
    mutate({ id, status: FindingStatus.Open, dismissReason: null }, () => reopenFinding(id));
  }

  function refresh() {
    startRefresh(async () => {
      const result = await refreshReview(reviewId);
      if (result.error !== undefined) {
        toast.error(result.error);
        return;
      }

      toast.success(refreshMessage(result.data));
    });
  }

  // Select a finding, scroll its inline card into view and pulse it.
  function select(id: number) {
    setSelectedId(id);
    setFlashId(id);
    setPanelOpen(false);
    setChatOpen(false);

    // A closing sheet restores focus, which would cancel the smooth scroll.
    const delay = panelOpen || chatOpen ? SHEET_CLOSE_MS : 0;
    setTimeout(() => {
      document.getElementById(findingAnchor(id))?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById(listAnchor(id))?.scrollIntoView({ block: "nearest" });
    }, delay);
  }

  function ask(f: Finding) {
    chatRef.current?.prefill(`About #${f.id} (${f.path}:${f.startLine}): `);
    setChatOpen(true);
  }

  function verify(f: Finding) {
    chatRef.current?.send(
      `Verify #${f.id} in the sandbox: write a minimal program that reproduces "${f.failure ?? f.title}" using the project code, run it with run_code, and tell me whether the bug is confirmed.`,
    );
    setChatOpen(true);
  }

  function step(direction: Step) {
    if (listed.length === 0) {
      return;
    }

    const at = listed.findIndex((f) => f.id === selectedId);
    const next = at === -1 ? (direction === Step.Next ? 0 : listed.length - 1) : at + direction;
    const target = listed[Math.min(Math.max(next, 0), listed.length - 1)];
    select(target.id);
  }

  // Single-key shortcuts; ignored while typing or with a dialog open.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || chatOpen || helpOpen || panelOpen) {
      return;
    }

    const selected = findings.find((f) => f.id === selectedId && f.status === FindingStatus.Open);
    const actions: Record<string, () => void> = {
      j: () => step(Step.Next),
      k: () => step(Step.Prev),
      a: () => selected?.replacement != null && apply(selected.id),
      d: () => selected && setDismissingId(selected.id),
      c: () => setChatOpen(true),
      r: () => !running && refresh(),
      "?": () => setHelpOpen(true),
    };

    const action = actions[e.key];
    if (!action) {
      return;
    }

    e.preventDefault();
    action();
  });

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const panel = (
    <FindingsPanel
      findings={findings}
      listed={listed}
      categories={categories}
      filters={filters}
      onFiltersChange={setFilters}
      selectedId={selectedId}
      onSelect={select}
      running={running}
    />
  );

  return (
    <ReportContext
      value={{
        categories,
        rules,
        selectedId,
        flashId,
        busy,
        dismissingId,
        setDismissingId,
        apply,
        undo,
        undoableFixes: report.undoableFixes,
        dismiss,
        reopen,
        ask,
        canVerify,
        verify,
        select,
      }}
    >
      <div className="flex h-[calc(100dvh-3rem)] flex-col">
        <ReportHeader
          report={report}
          running={running}
          refreshing={refreshing}
          onRefresh={refresh}
          onOpenChat={() => setChatOpen(true)}
          onOpenFindings={() => setPanelOpen(true)}
          openCount={openCount}
        />

        <div className="grid min-h-0 flex-1 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_380px]">
          <aside className="hidden min-h-0 overflow-y-auto border-r lg:block">
            <FileList files={report.files} units={report.units} findings={findings} categories={categories} />
          </aside>

          <main className="min-h-0 overflow-y-auto" aria-label="Diff">
            <Overview summary={report.review.summary} running={running} />
            {report.files.length === 0 ? (
              <NoChanges running={running} />
            ) : (
              report.files.map((file) => (
                <FileDiff
                  key={file.id}
                  file={file}
                  units={report.units.filter((u) => u.fileId === file.id)}
                  findings={scoped.filter((f) => f.fileId === file.id)}
                  theme={theme}
                />
              ))
            )}
          </main>

          <aside className="hidden min-h-0 border-l xl:block" aria-label="Findings">
            {panel}
          </aside>
        </div>
      </div>

      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:sm:max-w-md">
          <SheetTitle className="sr-only">Findings</SheetTitle>
          {panel}
        </SheetContent>
      </Sheet>

      <ReviewChat
        ref={chatRef}
        reviewId={reviewId}
        initialMessages={chat}
        open={chatOpen}
        onOpenChange={setChatOpen}
        findingIds={new Set(findings.map((f) => f.id))}
        onCite={select}
      />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </ReportContext>
  );
}

// "Change overview" from the review's overview pass.
function Overview({ summary, running }: { summary: string; running: boolean }) {
  if (!summary) {
    return running ? <p className="border-b px-4 py-3 text-sm text-muted-foreground">Writing change overview…</p> : null;
  }

  return (
    <Collapsible defaultOpen className="border-b">
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 px-4 py-2.5 text-left text-sm font-medium outline-none hover:bg-muted/50 focus-visible:bg-muted/50">
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-panel-open:rotate-90" aria-hidden />
        Change overview
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="max-w-3xl px-4 pb-3 pl-10 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{summary}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function NoChanges({ running }: { running: boolean }) {
  return (
    <Empty className="mt-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileX2 />
        </EmptyMedia>
        <EmptyTitle>{running ? "Reading the diff…" : "No changes in this range"}</EmptyTitle>
        {!running && <EmptyDescription>Edit files and press Refresh to pick up working-tree changes.</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}

// "2 files changed, 1 removed" / "No changes on disk".
function refreshMessage({ changed, removed }: { changed: number; removed: number }): string {
  if (changed === 0 && removed === 0) {
    return "No changes on disk";
  }

  const parts = [];
  if (changed > 0) {
    parts.push(`${changed} ${changed === 1 ? "file" : "files"} changed`);
  }

  if (removed > 0) {
    parts.push(`${removed} removed`);
  }

  return parts.join(", ");
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

const noop = () => () => {};

// Diff theme follows dark mode. Light during SSR and hydration: no mismatch.
function useDiffTheme(): "light" | "dark" {
  const { resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  return mounted && resolvedTheme === "dark" ? "dark" : "light";
}
