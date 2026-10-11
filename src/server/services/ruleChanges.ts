import type { UIMessage } from "ai";
import type { z } from "zod";
import {
  ChangeKind,
  ChangeScope,
  ChangeStatus,
  ruleKey,
  Severity,
} from "@/lib/domain";
import { changeById, insertChanges, pendingChanges, setChangeStatus, type ChangeInput } from "@/server/drivers/changeStore";
import { loadMessages } from "@/server/drivers/chatStore";
import { generateObject } from "@/server/drivers/llm";
import { markFeedbackUsed, unusedDismissals } from "@/server/drivers/reviewStore";
import { categoryById, insertRules, ruleById, rulesFor, updateRule } from "@/server/drivers/ruleStore";
import { InputError } from "./errors";
import { getProject } from "./projects";
import { resolveModel } from "./providers";
import { RULE_CHANGE_INSTRUCTIONS, ruleChangePrompt, ruleChangeSchema } from "./review/prompts";
import { overrideRule, projectRules, type CategoryView } from "./rules";

// Learning loop:
//   dismissed findings (+ reasons, chat remarks) ─► LLM ─► proposed changes
//   ─► user accepts (project override, or global edit) or rejects each one.

export type ChangeView = {
  id: number;
  kind: ChangeKind;
  ruleId: number | null;
  // Current rule name, description and severity, for the before/after view.
  ruleName: string | null;
  ruleDescription: string | null;
  ruleSeverity: Severity | null;
  categoryName: string | null;
  categoryColor: string | null;
  name: string | null;
  description: string | null;
  severity: Severity | null;
  rationale: string;
  findingIds: number[];
  // Global rule: can be promoted to a global edit.
  globalRule: boolean;
};

const MAX_CHAT_REMARKS = 30;
const MAX_REMARK_CHARS = 400;
const RULE_KEY = /^R?(\d+)$/i;

export function listChanges(projectId: number): ChangeView[] {
  getProject(projectId);
  const categories = projectRules(projectId);
  const rules = new Map(categories.flatMap((c) => c.rules.map((r) => [r.id, { rule: r, category: c }] as const)));

  return pendingChanges(projectId).map((c) => {
    const target = c.ruleId === null ? undefined : rules.get(c.ruleId);
    const category = target?.category ?? categories.find((x) => x.id === c.categoryId);
    return {
      id: c.id,
      kind: c.kind,
      ruleId: c.ruleId,
      ruleName: target?.rule.name ?? null,
      ruleDescription: target?.rule.description ?? null,
      ruleSeverity: target?.rule.severity ?? null,
      categoryName: category?.name ?? null,
      categoryColor: category?.color ?? null,
      name: c.name,
      description: c.description,
      severity: c.severity,
      rationale: c.rationale,
      findingIds: JSON.parse(c.findingIds),
      globalRule: c.ruleId !== null && ruleById(c.ruleId)?.projectId === null,
    };
  });
}

// Asks the LLM for rule changes from dismissals not used yet.
export async function generateChanges(projectId: number): Promise<number> {
  const project = getProject(projectId);
  const dismissed = unusedDismissals(projectId);
  if (dismissed.length === 0) {
    throw new InputError("No new dismissed findings to learn from");
  }

  const model = resolveModel(project.modelId);
  const categories = projectRules(projectId);

  const dismissedText = dismissed
    .map((f) => {
      const reason = f.dismissReason ? `Reason: ${f.dismissReason}` : "No reason given";
      return `#${f.id} [${ruleKey(f.ruleId)}] ${f.path}:${f.startLine} ${f.title}\n${f.explanation}\nCode: ${f.quote}\n${reason}`;
    })
    .join("\n\n");

  const reviewIds = [...new Set(dismissed.map((f) => f.reviewId))];
  const { object } = await generateObject(model.config, {
    instructions: RULE_CHANGE_INSTRUCTIONS,
    prompt: ruleChangePrompt(formatAll(categories), dismissedText, chatRemarks(reviewIds)),
    schema: ruleChangeSchema,
  });

  const known = new Set(dismissed.map((f) => f.id));
  const changes = object.changes
    .map((c) => toChange(projectId, c, categories, dismissed[0].categoryId, known))
    .filter((c): c is ChangeInput => c !== null);

  insertChanges(changes);
  markFeedbackUsed([...known]);
  return changes.length;
}

function formatAll(categories: CategoryView[]): string {
  return categories
    .map((c) => {
      const rules = c.rules.map((r) => `- [${ruleKey(r.id)}] (${r.severity}${r.enabled ? "" : ", disabled"}) ${r.name}: ${r.description}`);
      return [`### ${c.name}${c.enabled ? "" : " (disabled)"}`, ...rules].join("\n");
    })
    .join("\n\n");
}

// What the user typed in the chats of these reviews: often why a finding is wrong.
function chatRemarks(reviewIds: number[]): string {
  return reviewIds
    .flatMap((id) => loadMessages(id) as UIMessage[])
    .filter((m) => m.role === "user")
    .map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").slice(0, MAX_REMARK_CHARS))
    .filter(Boolean)
    .slice(-MAX_CHAT_REMARKS)
    .map((t) => `- ${t}`)
    .join("\n");
}

type Draft = z.infer<typeof ruleChangeSchema>["changes"][number];

// Validates a drafted change against the project's rules. Null = dropped.
function toChange(
  projectId: number,
  d: Draft,
  categories: CategoryView[],
  fallbackCategory: number,
  known: Set<number>,
): ChangeInput | null {
  const kind = d.kind as ChangeKind;
  const ruleId = d.rule ? Number(RULE_KEY.exec(d.rule.trim())?.[1]) : NaN;
  const rule = categories.flatMap((c) => c.rules).find((r) => r.id === ruleId);
  const base = {
    projectId,
    kind,
    rationale: d.rationale,
    findingIds: JSON.stringify(d.findings.filter((id) => known.has(id))),
    status: ChangeStatus.Pending,
  };

  if (kind === ChangeKind.Add) {
    const category = categories.find((c) => c.name.toLowerCase() === d.category?.toLowerCase());
    if (!d.name?.trim() || !d.description?.trim()) {
      return null;
    }

    return {
      ...base,
      categoryId: category?.id ?? fallbackCategory,
      name: d.name!.trim(),
      description: d.description!.trim(),
      severity: d.severity ?? null,
    };
  }

  if (!rule) {
    return null;
  }

  if (kind === ChangeKind.Edit && (!d.name?.trim() || !d.description?.trim())) {
    return null;
  }

  if (kind === ChangeKind.Severity && !d.severity) {
    return null;
  }

  return { ...base, ruleId: rule.id, name: d.name?.trim() || null, description: d.description?.trim() || null, severity: d.severity ?? null };
}

// Applies a change. Project scope = override for this project only;
// global scope edits the rule for every project.
export function acceptChange(id: number, scope: ChangeScope): void {
  const change = requirePending(id);
  const project = change.projectId;

  if (change.kind === ChangeKind.Add) {
    const category = change.categoryId === null ? undefined : categoryById(change.categoryId);
    if (!category) {
      throw new InputError("Category no longer exists");
    }

    // Rules of a project category can't be global.
    const global = scope === ChangeScope.Global && category.projectId === null;
    const position = rulesFor(project).filter((r) => r.categoryId === category.id).length;
    insertRules([{
      categoryId: category.id,
      projectId: global ? null : project,
      name: change.name ?? "",
      description: change.description ?? "",
      severity: change.severity ?? Severity.Minor,
      position,
    }]);
    setChangeStatus(id, ChangeStatus.Accepted);
    return;
  }

  const rule = change.ruleId === null ? undefined : ruleById(change.ruleId);
  if (!rule) {
    throw new InputError("Rule no longer exists");
  }

  const patch = {
    [ChangeKind.Edit]: { name: change.name, description: change.description },
    [ChangeKind.Severity]: { severity: change.severity },
    [ChangeKind.Disable]: { enabled: false },
  }[change.kind];

  // Project-only rules and global-scope changes edit the rule itself.
  if (rule.projectId !== null || scope === ChangeScope.Global) {
    updateRule(rule.id, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null)));
  } else {
    overrideRule(project, rule.id, patch);
  }

  setChangeStatus(id, ChangeStatus.Accepted);
}

export function rejectChange(id: number): void {
  requirePending(id);
  setChangeStatus(id, ChangeStatus.Rejected);
}

function requirePending(id: number) {
  const change = changeById(id);
  if (!change || change.status !== ChangeStatus.Pending) {
    throw new InputError("Change not found or already handled");
  }

  return change;
}
