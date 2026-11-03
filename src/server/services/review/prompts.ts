import { z } from "zod";
import { Confidence, FileChange, ruleKey, Severity } from "@/lib/domain";
import { readSetting } from "@/server/drivers/settingStore";
import { formatHunks, LineKind, type Hunk, type ParsedFile } from "../diffParse";
import type { RulesSnapshot } from "../rules";

// Prompt builders for every LLM call. Kept in one place so prompt changes
// are easy to review. Instructions are editable in Settings (see PromptKey);
// output formats stay fixed because parsing depends on them.

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

// --- planning (orchestrator) ----------------------------------------------

// One call before the units: the orchestrator reads the whole change,
// writes the overview every reviewer gets, and groups files that must be
// reviewed together, each group with what to check.
//   [pay.ts, invoice.ts, pay.test.ts, readme.md]
//     → "Refund flow": pay.ts, invoice.ts, pay.test.ts · "Docs": readme.md
export const MAX_GROUP_FILES = 6;

const PLAN_INSTRUCTIONS = `You lead a code review. Each reviewer gets one group of changed files, the overview you write, and read-only tools to explore the rest of the repository.
1. "overview": at most 150 words for the reviewers: what the change does, which components it touches, and cross-file relationships that matter (renamed functions, new parameters, moved logic, changed contracts or data shapes). Plain prose.
2. "groups": split the changed files into groups reviewed together. Put files in one group when a bug could hide in how they interact: a function and its callers, a schema and its queries, an interface and its implementations, code and its tests. Keep unrelated files apart. At most ${MAX_GROUP_FILES} files per group, every changed file in exactly one group, paths copied exactly.
   - "title": 2 to 5 words, e.g. "Refund calculation".
   - "focus": one or two sentences on what could break and where to look, e.g. "balance() now returns cents; check that PaymentService still compares cents."`;

const PLAN_JSON_SHAPE = `
Respond with JSON only:
{"overview":"...","groups":[{"title":"...","files":["src/a.ts","src/b.ts"],"focus":"..."}]}`;

export const planSchema = z.object({
  overview: z.string(),
  groups: z.array(z.object({ title: z.string(), files: z.array(z.string()), focus: z.string() })),
});

export function planPrompt(description: string, files: ParsedFile[], budget: number) {
  return {
    instructions: instruction(PromptKey.Overview) + PLAN_JSON_SHAPE,
    prompt: section("Project", description || "(no description)") + changeDigest(files, budget),
  };
}

// --- orchestrator agent ----------------------------------------------------

// Models with tool calling get an orchestrator agent instead of the single
// planning call: it explores, delegates tasks to reviewer agents, checks
// what they report, and follows up on leads.
//
//   explore ─► spawn_reviewers(overview, tasks) ─► findings come back
//          ─► read doubtful ones ─► reject_findings ─► follow-up tasks ─► done
//
// Prompt built on what makes orchestrators work: self-contained briefs
// (objective, where to look, what is out of scope), effort scaled to the
// change, few well-chosen agents, and verification before trusting output.
export const MAX_FOLLOW_UPS = 3;

const ORCHESTRATOR_INSTRUCTIONS = `You lead the review of a code change. You plan the review, delegate it to reviewer agents, and check their work. You don't write findings yourself.

## Your team
Each reviewer you spawn gets your overview, one task (title, files, objective, out of scope), the full diffs and new versions of its files, the project's rules, and read-only tools over the reviewed version of the repository. Scope "full" runs a bug-hunting agent plus the rule checks on the task's files; scope "bugs" runs the bug-hunting agent only, for follow-ups on files already reviewed. Reviewers can't see each other or you: everything a reviewer needs must be in its task.

## How to work
1. Size the change from the file list and diff below. Small (one to three files, one concern): one task, little or no exploration. Medium: two to five tasks. Large: one task per cohesive area.
2. Explore only what the grouping needs: what the changed code touches outside the diff (callers of changed functions, shared types, configuration). A few calls, batched in one step.
3. Spawn every task in one spawn_reviewers call, with the overview. Cover every changed file listed: files you leave out are reviewed by directory, without your guidance.
   - Group files where a bug could hide in their interaction: a function and its callers, a schema and its queries, an interface and its implementations, code and its tests. At most ${MAX_GROUP_FILES} files per task.
   - Write each objective as a brief to a colleague who knows nothing else: what changed, what could break, where to look, the question to answer. e.g. "balance() now returns cents instead of francs. Check that every caller in PaymentService and ReportService still compares and formats cents: a mismatch charges 100× too much or too little."
   - Use out of scope to stop reviewers duplicating each other, e.g. "CSV formatting: another reviewer covers it."
4. Check the findings that come back. Read the code behind any doubtful one: confidence "possible", a claim about code the reviewer didn't quote, a severity that looks off, or two findings that contradict each other. Reject false positives with reject_findings and a one-line reason. Keep what you can't disprove.
5. Follow up only on concrete leads: an interaction between two tasks' files that no reviewer could see, or a finding that implies the same bug elsewhere. At most ${MAX_FOLLOW_UPS} follow-up tasks, scope "bugs", each with a precise objective.
6. Finish with two or three sentences: how you split the work, what you rejected and why, what you followed up.

## Principles
- Spend effort in proportion to risk: security, money, data integrity, concurrency and public contracts deserve depth; renames, docs and formatting don't.
- Few, well-briefed reviewers beat many vague ones. Never spawn more tasks than the change needs.
- Batch independent tool calls in one step.`;

export function orchestratorPrompt(description: string, files: ParsedFile[], unreviewed: string[], map: string, budget: number) {
  const todo = unreviewed.length === files.length
    ? ""
    : section("Files to review now", `${unreviewed.join("\n")}\n(The other changed files were reviewed already; include them in a task only for a follow-up.)`);

  return {
    instructions: instruction(PromptKey.Orchestrator),
    prompt: section("Project", description || "(no description)") + todo + changeDigest(files, budget) + section("Repository map", map),
  };
}

// Changed files with line counts, then a diff sample, within `budget`.
// The list comes first, cut to half the budget for very large changes:
// unlisted files are grouped by directory.
function changeDigest(files: ParsedFile[], budget: number): string {
  let listRoom = (budget * CHARS_PER_TOKEN) / 2;
  const listed: string[] = [];
  for (const f of files) {
    const line = `- ${f.path} (${f.change}, ${countChanges(f)})`;
    if (line.length > listRoom) {
      listed.push(`- … ${files.length - listed.length} more files, grouped automatically`);
      break;
    }

    listed.push(line);
    listRoom -= line.length + 1;
  }

  const list = section(`Changed files (${files.length})`, listed.join("\n"));

  // Sample of the diff, cut to the budget.
  let room = (budget - estimateTokens(list)) * CHARS_PER_TOKEN;
  const samples: string[] = [];
  for (const f of files) {
    if (room <= 0) {
      break;
    }

    const text = `### ${f.path}\n${formatHunks(f.hunks)}`.slice(0, room);
    samples.push(text);
    room -= text.length;
  }

  return list + section("Diff (may be truncated)", samples.join("\n\n"));
}

function countChanges(f: ParsedFile): string {
  const lines = f.hunks.flatMap((h) => h.lines);
  const added = lines.filter((l) => l.kind === LineKind.Add).length;
  const removed = lines.filter((l) => l.kind === LineKind.Del).length;
  return `+${added} -${removed}`;
}

// --- review pass -----------------------------------------------------------

const REVIEW_INSTRUCTIONS = `You are a meticulous code reviewer. Review only the changed lines (marked "+") of the files below against the rules given. The files were grouped because they interact: check how the changes in one affect the others.
- Report a finding only when the changed code clearly violates a listed rule. No other remarks.
- Cite exactly one rule key per finding, e.g. "R12".
- "path": the file of the offending lines, copied from its diff heading.
- "quote": the offending lines copied verbatim from the new code, without line numbers or +/- markers. Keep it short: only the lines at fault.
- "startLine"/"endLine": line numbers of the quote in the new file (left column of the diff).
- "explanation": why it violates the rule, 1-3 sentences.
- "replacement": code that replaces exactly the quoted lines, same indentation, when the fix is local and safe. Otherwise null.
- If nothing violates the rules, return an empty list.`;

const BUGS_INSTRUCTIONS = `This pass is about bugs only: defects that make the code behave incorrectly.
- "failure": a concrete failure, an input or state and the wrong result, e.g. "order_ids=[] → ZeroDivisionError". If you can't name one, don't report the finding.
- "confidence": "likely" when the failure follows from the code shown, "possible" when it depends on code you can't see.`;

const RULES_INSTRUCTIONS = `Set "failure" and "confidence" to null.`;

// Bugs pass, when other files use what the diff changes.
const USAGES_INSTRUCTIONS = `- "Usages in other files" shows unchanged code that uses identifiers this diff changes. Check that each usage still works with the change. A usage it breaks is a finding on the changed line responsible; name the usage (path:line) in "failure".`;

// Bugs pass of a model with tool calling: the unit is an agent that
// explores the repository before answering. Budget appended by the engine.
const AGENT_INSTRUCTIONS = `You are one reviewer on a team led by an orchestrator. When "Your task" is given, answer its objective first, then check the rest of your files' changes; leave what it marks out of scope to the other reviewers.
You have read-only tools over the reviewed version of the repository. Use them to check what the diff can't show: how callers use a changed function, what a called function really does, whether an empty or null case is handled upstream, what an interface promises.
- Start with the riskiest changes: changed signatures, return values, conditions, error handling, shared state.
- Batch independent calls in one step, e.g. find_usages for two functions and read_symbol for a third. Prefer read_symbol and find_usages over reading whole files. The repository map shows where things are.
- Stop once the risky changes are checked. Report only what code you read supports.
- A finding goes on the changed line responsible, in one of the changed files, even when the evidence is elsewhere: name that evidence (path:line) in "failure".`;

// Spelled out because models without JSON-schema support only see the prompt.
const JSON_SHAPE = `
Respond with JSON only:
{"findings":[{"path":"src/a.ts","rule":"R12","title":"short title","severity":"info|minor|major|critical","startLine":10,"endLine":12,"quote":"...","explanation":"...","replacement":"..." or null,"failure":"..." or null,"confidence":"likely|possible" or null}]}`;

export const findingsSchema = z.object({
  findings: z.array(
    z.object({
      path: z.string(),
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

// One file of a unit: its diff hunks and new version (null when unavailable).
export type UnitFile = { file: ParsedFile; hunks: Hunk[]; content: string | null };

type UnitInput = {
  kind: PassKind;
  description: string;
  summary: string;
  // Planner's notes for the group; "" for ungrouped units.
  focus: string;
  categories: SnapshotCategory[];
  files: UnitFile[];
  budget: number;
  // grep output from lookupPrompt's identifiers; "" when none.
  usages: string;
  // Agent units: tool rounds, the repository map, and other changed files.
  agent: { steps: number; repoMap: string; otherFiles: string[] } | null;
};

// --- conclusion ------------------------------------------------------------

const CONCLUSION_INSTRUCTIONS = `You recap a finished code review for the developer who wrote the change.
Markdown, at most 150 words:
- First line: a one-sentence verdict, e.g. "Ready to merge after fixing two bugs." or "No blocking issues."
- Then up to 5 bullets: the issues to fix first, citing findings as #id, grouped when they share a cause.
- Mention recurring patterns (same rule hit in many places) once.
State only what the findings support. No praise.`;

// Findings per line: "#12 major R3 Null check · src/a.ts:40 · title: explanation".
const CONCLUSION_EXPLANATION_CHARS = 200;

export type ConclusionFinding = {
  id: number;
  severity: Severity;
  rule: string;
  path: string;
  line: number;
  title: string;
  explanation: string;
};

export function conclusionPrompt(overview: string, files: string[], findings: ConclusionFinding[], budget: number) {
  const head = section("Change overview", overview || "(none)") + section("Reviewed files", files.join("\n") || "(none)");

  // Most severe first, cut to the budget.
  let room = (budget - estimateTokens(head)) * CHARS_PER_TOKEN;
  const lines: string[] = [];
  for (const f of findings) {
    const line = `- #${f.id} ${f.severity} ${f.rule} · ${f.path}:${f.line} · ${f.title}: ${f.explanation.slice(0, CONCLUSION_EXPLANATION_CHARS)}`;
    if (line.length > room) {
      lines.push(`- … ${findings.length - lines.length} more`);
      break;
    }

    lines.push(line);
    room -= line.length;
  }

  return {
    instructions: instruction(PromptKey.Conclusion),
    prompt: head + section(`Open findings (${findings.length})`, lines.join("\n") || "(none)"),
  };
}

// --- usage lookup ----------------------------------------------------------

// Before the bugs pass: the model names what the diff changes, the engine
// greps for its usages in other files.
//   diff: "- return total - paid;" → ["balance"] → "Pay.java:44: long r = balance(…)"
export const MAX_LOOKUPS = 5;

const LOOKUP_INSTRUCTIONS = `You prepare the bug review of the changed files below.
List the identifiers (methods, functions, fields, constants, enum constants, types) whose signature, return value, meaning or side effects this diff changes, so a reviewer can check the code that uses them elsewhere. Also list new enum constants and new values of closed sets.
At most ${MAX_LOOKUPS}, most important first. Bare names, e.g. "savePayment". Empty list when the diff only adds code that nothing else uses yet.`;

const LOOKUP_JSON_SHAPE = `
Respond with JSON only: {"identifiers":["savePayment"]}`;

export const lookupSchema = z.object({ identifiers: z.array(z.string()) });

export function lookupPrompt(files: UnitFile[]) {
  return {
    instructions: instruction(PromptKey.Lookup) + LOOKUP_JSON_SHAPE,
    prompt: files.map((f) => section(`Diff of ${f.file.path} (new line numbers on the left)`, formatHunks(f.hunks))).join(""),
  };
}

// Other changed files listed to an agent, so it knows what else moves.
const MAX_OTHER_FILES = 100;

// Prompt for one unit (a file chunk or a group of files) × one pass.
// Shrinks context to fit the budget, per file: whole file → windows
// around hunks → hunks only.
export function unitPrompt(u: UnitInput) {
  const parts = [instruction(PromptKey.Review), instruction(u.kind === PassKind.Bugs ? PromptKey.Bugs : PromptKey.Rules)];
  if (u.usages) {
    parts.push(instruction(PromptKey.Usages));
  }

  if (u.agent) {
    parts.push(instruction(PromptKey.Agent), `- You have about ${u.agent.steps} tool rounds.`);
  }
  const instructions = parts.join("\n") + JSON_SHAPE;

  const others = u.agent?.otherFiles ?? [];
  const otherList = others.slice(0, MAX_OTHER_FILES).join("\n") + (others.length > MAX_OTHER_FILES ? `\n… ${others.length - MAX_OTHER_FILES} more` : "");

  const core =
    section("Project", u.description || "(no description)") +
    section("Change overview", u.summary || "(none)") +
    (u.focus ? section("Your task", u.focus) : "") +
    section("Rules", formatRules(u.categories)) +
    u.files.map((f) => section(`Diff of ${fileLabel(f.file)} (new line numbers on the left)`, formatHunks(f.hunks))).join("") +
    (u.usages ? section("Usages in other files (path:line: match, path-line- context)", u.usages) : "") +
    (u.agent && others.length > 0 ? section("Other files changed in this review", otherList) : "") +
    (u.agent ? section("Repository map", u.agent.repoMap) : "");

  // Smallest files first: more of them get their full text.
  let room = u.budget - estimateTokens(instructions + core);
  const contexts: string[] = [];
  for (const f of [...u.files].sort((a, b) => (a.content?.length ?? 0) - (b.content?.length ?? 0))) {
    const context = pickContext(f, room);
    room -= estimateTokens(context);
    contexts.push(context);
  }

  return { instructions, prompt: core + contexts.join("") };
}

function fileLabel(file: ParsedFile): string {
  return file.change === FileChange.Renamed ? `${file.path} (renamed from ${file.oldPath})` : `${file.path} (${file.change})`;
}

function pickContext({ file, hunks, content }: UnitFile, room: number): string {
  if (!content) {
    return "";
  }

  const whole = section(`Full file ${file.path}, new version`, numbered(content.split(/\r?\n/), 1));
  if (estimateTokens(whole) <= room) {
    return whole;
  }

  const windows = section(`Code around the changes in ${file.path}, new version`, aroundHunks(content, hunks));
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
      const rules = c.rules.map((r) => `- [${ruleKey(r.id)}] (${r.severity}) ${r.name}: ${r.description}`);
      return [head, ...rules].join("\n");
    })
    .join("\n\n");
}

// Fixed prompt cost of a unit, for chunking hunks before prompts exist.
export function unitOverhead(description: string, summary: string, categories: SnapshotCategory[]): number {
  const fixed = [PromptKey.Review, PromptKey.Bugs, PromptKey.Usages, PromptKey.Agent].map(instruction).join("\n") + JSON_SHAPE;
  return estimateTokens(fixed + description + summary + formatRules(categories));
}

export function hunkTokens(h: Hunk): number {
  return estimateTokens(formatHunks([h]));
}

// --- project description ---------------------------------------------------

const DESCRIBE_INSTRUCTIONS = `You write a short project description that code reviewers read before reviewing changes.
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

const RULE_CHANGE_INSTRUCTIONS = `You maintain the rules of an LLM code reviewer. The user dismissed some findings, often with a reason. Propose rule changes so similar false positives stop, without losing real issues.
Kinds:
- "edit": rewrite a rule's name and description to be more precise (e.g. add an exception). Set "rule", "name" and "description".
- "severity": change a rule's severity. Set "rule" and "severity".
- "disable": turn a rule off when it brings no value. Set "rule".
- "add": a new rule the dismissals reveal is missing. Set "category" (an existing category name), "name", "description" and "severity".
Each change lists the finding ids that motivated it and a one-sentence rationale.
Propose nothing for dismissals that look like one-off model mistakes. An empty list is a valid answer.`;

export const ruleChangeSchema = z.object({
  changes: z.array(
    z.object({
      kind: z.enum(["edit", "severity", "disable", "add"]),
      rule: z.string().nullable(),
      category: z.string().nullable(),
      name: z.string().nullable(),
      description: z.string().nullable(),
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

// --- editable instructions -------------------------------------------------

// Setting keys of the instructions users can rewrite in Settings → Prompts.
export enum PromptKey {
  Overview = "prompt_overview",
  Review = "prompt_review",
  Bugs = "prompt_bugs",
  Rules = "prompt_rules",
  Lookup = "prompt_lookup",
  Usages = "prompt_usages",
  Agent = "prompt_agent",
  Orchestrator = "prompt_orchestrator",
  Describe = "prompt_describe",
  RuleChanges = "prompt_rule_changes",
  Conclusion = "prompt_conclusion",
}

export const PROMPT_DEFAULTS: Record<PromptKey, string> = {
  [PromptKey.Overview]: PLAN_INSTRUCTIONS,
  [PromptKey.Review]: REVIEW_INSTRUCTIONS,
  [PromptKey.Bugs]: BUGS_INSTRUCTIONS,
  [PromptKey.Rules]: RULES_INSTRUCTIONS,
  [PromptKey.Lookup]: LOOKUP_INSTRUCTIONS,
  [PromptKey.Usages]: USAGES_INSTRUCTIONS,
  [PromptKey.Agent]: AGENT_INSTRUCTIONS,
  [PromptKey.Orchestrator]: ORCHESTRATOR_INSTRUCTIONS,
  [PromptKey.Describe]: DESCRIBE_INSTRUCTIONS,
  [PromptKey.RuleChanges]: RULE_CHANGE_INSTRUCTIONS,
  [PromptKey.Conclusion]: CONCLUSION_INSTRUCTIONS,
};

// The user's version when saved, else the default. Empty = default.
export function instruction(key: PromptKey): string {
  return readSetting(key) || PROMPT_DEFAULTS[key];
}

function section(title: string, body: string): string {
  return `## ${title}\n${body}\n\n`;
}
