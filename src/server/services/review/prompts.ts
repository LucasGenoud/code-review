import { z } from "zod";
import { Confidence, FileChange, ruleKey, Severity } from "@/lib/domain";
import { formatHunks, LineKind, type Hunk, type ParsedFile } from "../diffParse";
import type { RulesSnapshot } from "../rules";

// Prompt builders for every LLM call. Kept in one place so prompt changes
// are easy to review.

export enum PassKind {
  Bugs = "bugs",
  Rules = "rules",
}

type SnapshotCategory = RulesSnapshot["categories"][number];

// shortcut: ~4 chars per token. Good enough for budgeting; use a real
// tokenizer if prompts start overflowing context windows.
const CHARS_PER_TOKEN = 4;

// Lines around each hunk when the whole file doesn't fit.
const CONTEXT_LINES = 25;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// --- overview pass ---------------------------------------------------------

const OVERVIEW_INSTRUCTIONS = `You summarize a code change for reviewers who will each see only one file.
Write at most 150 words: what the change does, which components it touches, and cross-file relationships that matter when reviewing a single file (renamed functions, new parameters, moved logic).
Plain prose, no headings, no code.`;

export function overviewPrompt(description: string, files: ParsedFile[], budget: number) {
  const list = files.map((f) => `- ${f.path} (${f.change}, ${countChanges(f)})`).join("\n");
  const head = section("Project", description || "(no description)") + section("Changed files", list);

  // Sample of the diff, cut to the budget.
  let room = (budget - estimateTokens(head)) * CHARS_PER_TOKEN;
  const samples: string[] = [];
  for (const f of files) {
    if (room <= 0) {
      break;
    }

    const text = `### ${f.path}\n${formatHunks(f.hunks)}`.slice(0, room);
    samples.push(text);
    room -= text.length;
  }

  return {
    instructions: OVERVIEW_INSTRUCTIONS,
    prompt: head + section("Diff (may be truncated)", samples.join("\n\n")),
  };
}

function countChanges(f: ParsedFile): string {
  const lines = f.hunks.flatMap((h) => h.lines);
  const added = lines.filter((l) => l.kind === LineKind.Add).length;
  const removed = lines.filter((l) => l.kind === LineKind.Del).length;
  return `+${added} -${removed}`;
}

// --- review pass -----------------------------------------------------------

const REVIEW_INSTRUCTIONS = `You are a meticulous code reviewer. Review only the changed lines (marked "+") of one file against the rules given.
- Report a finding only when the changed code clearly violates a listed rule. No other remarks.
- Cite exactly one rule key per finding, e.g. "R12".
- "quote": the offending lines copied verbatim from the new code, without line numbers or +/- markers. Keep it short: only the lines at fault.
- "startLine"/"endLine": line numbers of the quote in the new file (left column of the diff).
- "explanation": why it violates the rule, 1-3 sentences.
- "replacement": code that replaces exactly the quoted lines, same indentation, when the fix is local and safe. Otherwise null.
- If nothing violates the rules, return an empty list.`;

const BUGS_INSTRUCTIONS = `
This pass is about bugs only: defects that make the code behave incorrectly.
- "failure": a concrete failure, an input or state and the wrong result, e.g. "order_ids=[] → ZeroDivisionError". If you can't name one, don't report the finding.
- "confidence": "likely" when the failure follows from the code shown, "possible" when it depends on code you can't see.`;

const RULES_INSTRUCTIONS = `
Set "failure" and "confidence" to null.`;

// Spelled out because models without JSON-schema support only see the prompt.
const JSON_SHAPE = `
Respond with JSON only:
{"findings":[{"rule":"R12","title":"short title","severity":"info|minor|major|critical","startLine":10,"endLine":12,"quote":"...","explanation":"...","replacement":"..." or null,"failure":"..." or null,"confidence":"likely|possible" or null}]}`;

export const findingsSchema = z.object({
  findings: z.array(
    z.object({
      rule: z.string(),
      title: z.string(),
      severity: z.enum(Severity),
      startLine: z.number().int(),
      endLine: z.number().int(),
      quote: z.string(),
      explanation: z.string(),
      replacement: z.string().nullable(),
      failure: z.string().nullable(),
      confidence: z.enum(Confidence).nullable(),
    }),
  ),
});

export type FindingDraft = z.infer<typeof findingsSchema>["findings"][number];

type UnitInput = {
  kind: PassKind;
  description: string;
  summary: string;
  categories: SnapshotCategory[];
  file: ParsedFile;
  hunks: Hunk[];
  // New version of the file; null when unavailable.
  content: string | null;
  budget: number;
};

// Prompt for one file chunk × one pass. Shrinks context to fit the budget:
// whole file → windows around hunks → hunks only.
export function unitPrompt(u: UnitInput) {
  const instructions =
    REVIEW_INSTRUCTIONS + (u.kind === PassKind.Bugs ? BUGS_INSTRUCTIONS : RULES_INSTRUCTIONS) + JSON_SHAPE;

  const fileLabel = u.file.change === FileChange.Renamed
    ? `${u.file.path} (renamed from ${u.file.oldPath})`
    : `${u.file.path} (${u.file.change})`;

  const core =
    section("Project", u.description || "(no description)") +
    section("Change overview", u.summary || "(none)") +
    section("Rules", formatRules(u.categories)) +
    section(`Diff of ${fileLabel} (new line numbers on the left)`, formatHunks(u.hunks));

  const room = u.budget - estimateTokens(instructions + core);
  const context = pickContext(u.content, u.hunks, room);
  return { instructions, prompt: core + context };
}

function pickContext(content: string | null, hunks: Hunk[], room: number): string {
  if (!content) {
    return "";
  }

  const whole = section("Full file, new version", numbered(content.split(/\r?\n/), 1));
  if (estimateTokens(whole) <= room) {
    return whole;
  }

  const windows = section("Code around the changes, new version", aroundHunks(content, hunks));
  return estimateTokens(windows) <= room ? windows : "";
}

function aroundHunks(content: string, hunks: Hunk[]): string {
  const lines = content.split(/\r?\n/);
  const ranges = hunks.map((h) => {
    const newLines = h.lines.filter((l) => l.newNo !== null).length;
    return [
      Math.max(1, h.newStart - CONTEXT_LINES),
      Math.min(lines.length, h.newStart + newLines + CONTEXT_LINES),
    ];
  });

  // Merge overlapping windows.
  const merged: number[][] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], r[1]);
      continue;
    }

    merged.push([...r]);
  }

  return merged
    .map(([from, to]) => numbered(lines.slice(from - 1, to), from))
    .join("\n     ...\n");
}

function numbered(lines: string[], first: number): string {
  const NUMBER_WIDTH = 5;
  return lines.map((l, i) => `${String(first + i).padStart(NUMBER_WIDTH)}   ${l}`).join("\n");
}

export function formatRules(categories: SnapshotCategory[]): string {
  return categories
    .map((c) => {
      const head = c.description ? `### ${c.name}: ${c.description}` : `### ${c.name}`;
      const rules = c.rules.map((r) => `- [${ruleKey(r.id)}] (${r.severity}) ${r.text}`);
      return [head, ...rules].join("\n");
    })
    .join("\n\n");
}

// Fixed prompt cost of a unit, for chunking hunks before prompts exist.
export function unitOverhead(description: string, summary: string, categories: SnapshotCategory[]): number {
  return estimateTokens(REVIEW_INSTRUCTIONS + BUGS_INSTRUCTIONS + JSON_SHAPE + description + summary + formatRules(categories));
}

export function hunkTokens(h: Hunk): number {
  return estimateTokens(formatHunks([h]));
}

// --- project description ---------------------------------------------------

export const DESCRIBE_INSTRUCTIONS = `You write a short project description that code reviewers read before reviewing changes.
Markdown, at most 250 words, with these sections:
**Purpose**: what the project does.
**Stack**: languages, frameworks, key libraries.
**Structure**: main folders and what lives where.
**Conventions**: patterns visible in the code (error handling, naming, testing) worth enforcing.
State only what the material supports.`;

export function describePrompt(name: string, tree: string, docs: { file: string; text: string }[]) {
  return (
    section("Project name", name) +
    section("Files (truncated)", tree) +
    docs.map((d) => section(d.file, d.text)).join("")
  );
}

// --- rule changes ----------------------------------------------------------

export const RULE_CHANGE_INSTRUCTIONS = `You maintain the rules of an LLM code reviewer. The user dismissed some findings, often with a reason. Propose rule changes so similar false positives stop, without losing real issues.
Kinds:
- "edit": rewrite a rule's text to be more precise (e.g. add an exception). Set "rule" and "text".
- "severity": change a rule's severity. Set "rule" and "severity".
- "disable": turn a rule off when it brings no value. Set "rule".
- "add": a new rule the dismissals reveal is missing. Set "category" (an existing category name), "text" and "severity".
Each change lists the finding ids that motivated it and a one-sentence rationale.
Propose nothing for dismissals that look like one-off model mistakes. An empty list is a valid answer.`;

export const ruleChangeSchema = z.object({
  changes: z.array(
    z.object({
      kind: z.enum(["edit", "severity", "disable", "add"]),
      rule: z.string().nullable(),
      category: z.string().nullable(),
      text: z.string().nullable(),
      severity: z.enum(Severity).nullable(),
      rationale: z.string(),
      findings: z.array(z.number().int()),
    }),
  ),
});

export function ruleChangePrompt(rules: string, dismissed: string, chat: string) {
  return (
    section("Current rules", rules) +
    section("Dismissed findings", dismissed) +
    (chat ? section("User remarks from review chats", chat) : "")
  );
}

function section(title: string, body: string): string {
  return `## ${title}\n${body}\n\n`;
}
