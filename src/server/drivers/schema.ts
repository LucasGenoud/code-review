import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  CategoryKind,
  ChangeKind,
  ChangeStatus,
  Confidence,
  DiffMode,
  FileChange,
  FileState,
  FindingStatus,
  ProviderKind,
  ReviewStatus,
  Severity,
  UnitStatus,
} from "@/lib/domain";

// Data model:
//
//   providers ─< models
//   projects ─< reviews ─< review_files ─< review_units
//                  │            └──────< findings
//                  └─< chat_messages
//   categories (project_id null = global) ─< rules (project_id set = project-only)
//   category_overrides / rule_overrides: per-project tweaks of global rules
//   rule_changes: LLM-proposed rule edits, accepted or rejected by the user

function values<T extends Record<string, string>>(e: T): [string, ...string[]] {
  return Object.values(e) as [string, ...string[]];
}

function createdAt() {
  return integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());
}

export const providers = sqliteTable("providers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  kind: text("kind", { enum: values(ProviderKind) }).notNull().$type<ProviderKind>(),
  baseUrl: text("base_url"),
  // AES-GCM encrypted. Never sent to the browser.
  apiKey: text("api_key"),
  createdAt: createdAt(),
});

export const models = sqliteTable("models", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  providerId: integer("provider_id")
    .notNull()
    .references(() => providers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contextWindow: integer("context_window").notNull().default(128_000),
  maxConcurrency: integer("max_concurrency").notNull().default(4),
  // USD per million tokens. Null = unknown, cost not shown.
  inputCost: real("input_cost"),
  outputCost: real("output_cost"),
  toolCalling: integer("tool_calling", { mode: "boolean" }).notNull().default(true),
  // JSON-schema constrained output. Turn off for servers that reject it.
  jsonSchema: integer("json_schema", { mode: "boolean" }).notNull().default(true),
});

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  description: text("description").notNull().default(""),
  // Newline-separated globs, added to the global ignore list.
  ignoreGlobs: text("ignore_globs").notNull().default(""),
  modelId: integer("model_id").references(() => models.id, { onDelete: "set null" }),
  // Default rules for new reviews. Null = the project's enabled rules.
  ruleSetId: integer("rule_set_id").references(() => ruleSets.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: values(CategoryKind) })
    .notNull()
    .default(CategoryKind.Custom)
    .$type<CategoryKind>(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  description: text("description").notNull().default(""),
  // Newline-separated globs. Empty = all files.
  globs: text("globs").notNull().default(""),
  // Global default; a project can override it.
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  position: integer("position").notNull().default(0),
});

export const rules = sqliteTable("rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "cascade" }),
  // Set = rule exists only in this project (even inside a global category).
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull().default(""),
  // Reuse the legacy column to preserve stored instructions.
  description: text("text").notNull(),
  severity: text("severity", { enum: values(Severity) }).notNull().$type<Severity>(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  position: integer("position").notNull().default(0),
});

export const categoryOverrides = sqliteTable(
  "category_overrides",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.categoryId] })],
);

// Null fields inherit the global rule's value.
export const ruleOverrides = sqliteTable(
  "rule_overrides",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ruleId: integer("rule_id")
      .notNull()
      .references(() => rules.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }),
    name: text("name"),
    description: text("text"),
    severity: text("severity", { enum: values(Severity) }).$type<Severity>(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.ruleId] })],
);

export const reviews = sqliteTable("reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  mode: text("mode", { enum: values(DiffMode) }).notNull().$type<DiffMode>(),
  // Refs as typed by the user (branch, sha). Null for modes that need none.
  base: text("base"),
  head: text("head"),
  baseSha: text("base_sha"),
  // Null = working tree.
  headSha: text("head_sha"),
  modelId: integer("model_id").references(() => models.id, { onDelete: "set null" }),
  modelLabel: text("model_label").notNull(),
  status: text("status", { enum: values(ReviewStatus) }).notNull().$type<ReviewStatus>(),
  error: text("error"),
  // Overview pass output, shared with every unit prompt.
  summary: text("summary").notNull().default(""),
  // JSON RulesSnapshot: rules as they were when the review ran.
  rules: text("rules").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  createdAt: createdAt(),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
});

export const reviewFiles = sqliteTable("review_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reviewId: integer("review_id")
    .notNull()
    .references(() => reviews.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  oldPath: text("old_path"),
  change: text("change", { enum: values(FileChange) }).notNull().$type<FileChange>(),
  patch: text("patch").notNull(),
  hash: text("hash").notNull(),
  state: text("state", { enum: values(FileState) }).notNull().$type<FileState>(),
  skipReason: text("skip_reason"),
});

// One LLM call: a file (or a chunk of its hunks) × one rule pass.
export const reviewUnits = sqliteTable("review_units", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reviewId: integer("review_id")
    .notNull()
    .references(() => reviews.id, { onDelete: "cascade" }),
  fileId: integer("file_id")
    .notNull()
    .references(() => reviewFiles.id, { onDelete: "cascade" }),
  pass: text("pass").notNull(),
  // JSON number[]: categories reviewed in this pass.
  categoryIds: text("category_ids").notNull(),
  chunk: integer("chunk").notNull().default(0),
  // JSON number[]: indexes of the file's hunks in this chunk.
  hunks: text("hunks").notNull(),
  status: text("status", { enum: values(UnitStatus) }).notNull().$type<UnitStatus>(),
  error: text("error"),
  // Exact prompt sent, for the prompt preview.
  prompt: text("prompt"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
});

export const findings = sqliteTable("findings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reviewId: integer("review_id")
    .notNull()
    .references(() => reviews.id, { onDelete: "cascade" }),
  fileId: integer("file_id")
    .notNull()
    .references(() => reviewFiles.id, { onDelete: "cascade" }),
  unitId: integer("unit_id").references(() => reviewUnits.id, { onDelete: "set null" }),
  path: text("path").notNull(),
  startLine: integer("start_line").notNull(),
  endLine: integer("end_line").notNull(),
  quote: text("quote").notNull(),
  ruleId: integer("rule_id").notNull(),
  categoryId: integer("category_id").notNull(),
  severity: text("severity", { enum: values(Severity) }).notNull().$type<Severity>(),
  confidence: text("confidence", { enum: values(Confidence) }).$type<Confidence>(),
  title: text("title").notNull(),
  explanation: text("explanation").notNull(),
  // Bugs only: concrete input → wrong result.
  failure: text("failure"),
  replacement: text("replacement"),
  status: text("status", { enum: values(FindingStatus) }).notNull().$type<FindingStatus>(),
  dismissReason: text("dismiss_reason"),
  // Already fed into a rule-change generation.
  feedbackUsed: integer("feedback_used", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  reviewId: integer("review_id")
    .notNull()
    .references(() => reviews.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  // JSON UIMessage.
  message: text("message").notNull(),
});

// Persist exact file versions so undo survives reloads and preserves whitespace.
export const appliedFixes = sqliteTable("applied_fixes", {
  findingId: integer("finding_id").primaryKey().notNull().references(() => findings.id, { onDelete: "cascade" }),
  before: text("before").notNull(),
  after: text("after").notNull(),
  headSha: text("head_sha"),
  // JSON before/after locations and statuses of affected findings.
  findingStates: text("finding_states").notNull(),
});

export const ruleChanges = sqliteTable("rule_changes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: values(ChangeKind) }).notNull().$type<ChangeKind>(),
  ruleId: integer("rule_id").references(() => rules.id, { onDelete: "set null" }),
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  name: text("name"),
  description: text("text"),
  severity: text("severity", { enum: values(Severity) }).$type<Severity>(),
  rationale: text("rationale").notNull(),
  // JSON number[]: dismissed findings that motivated the change.
  findingIds: text("finding_ids").notNull(),
  status: text("status", { enum: values(ChangeStatus) }).notNull().$type<ChangeStatus>(),
  createdAt: createdAt(),
});

// Named subset of rules to review with instead of the project's enabled rules.
export const ruleSets = sqliteTable("rule_sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // JSON number[]: rule ids. Deleted rules are skipped when used.
  ruleIds: text("rule_ids").notNull(),
  createdAt: createdAt(),
});

export type Provider = typeof providers.$inferSelect;
export type Model = typeof models.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Rule = typeof rules.$inferSelect;
export type CategoryOverride = typeof categoryOverrides.$inferSelect;
export type RuleOverride = typeof ruleOverrides.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type ReviewFile = typeof reviewFiles.$inferSelect;
export type ReviewUnit = typeof reviewUnits.$inferSelect;
export type Finding = typeof findings.$inferSelect;
export type RuleChange = typeof ruleChanges.$inferSelect;
export type RuleSet = typeof ruleSets.$inferSelect;
