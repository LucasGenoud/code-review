import { z } from "zod";
import { readSetting, writeSetting } from "@/server/drivers/settingStore";
import { instruction, PROMPT_DEFAULTS, PromptKey } from "./review/prompts";

enum Key {
  DefaultModel = "default_model_id",
  IgnoreGlobs = "ignore_globs",
  PassThreshold = "pass_threshold",
  SandboxEnabled = "sandbox_enabled",
  SandboxTimeout = "sandbox_timeout",
}

const DEFAULT_SANDBOX_TIMEOUT = 10;
const TRUE = "1";

export type SandboxSettings = { enabled: boolean; timeoutSeconds: number };

const sandboxSchema = z.object({
  enabled: z.boolean(),
  timeoutSeconds: z.number().int().min(1).max(60),
});

// Off by default: the agent runs LLM-written code.
export function getSandboxSettings(): SandboxSettings {
  const timeout = readSetting(Key.SandboxTimeout);
  return {
    enabled: readSetting(Key.SandboxEnabled) === TRUE,
    timeoutSeconds: timeout ? Number(timeout) : DEFAULT_SANDBOX_TIMEOUT,
  };
}

export function saveSandboxSettings(input: SandboxSettings): void {
  const s = sandboxSchema.parse(input);
  writeSetting(Key.SandboxEnabled, s.enabled ? TRUE : "");
  writeSetting(Key.SandboxTimeout, String(s.timeoutSeconds));
}

// Generated, vendored and lock files: noise for a review.
const DEFAULT_IGNORE_GLOBS = [
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/bun.lockb",
  "**/poetry.lock",
  "**/Cargo.lock",
  "**/go.sum",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.snap",
  "**/dist/**",
  "**/build/**",
  "**/node_modules/**",
  "**/vendor/**",
].join("\n");

// Above this many rules in one file's custom categories, each category gets
// its own LLM pass. Long rule lists make models silently skip rules.
const DEFAULT_PASS_THRESHOLD = 15;

export type AppSettings = {
  defaultModelId: number | null;
  ignoreGlobs: string;
  passThreshold: number;
};

const settingsSchema = z.object({
  defaultModelId: z.number().int().nullable(),
  ignoreGlobs: z.string(),
  passThreshold: z.number().int().min(1).max(200),
});

export function getSettings(): AppSettings {
  const model = readSetting(Key.DefaultModel);
  const threshold = readSetting(Key.PassThreshold);

  return {
    defaultModelId: model ? Number(model) : null,
    ignoreGlobs: readSetting(Key.IgnoreGlobs) ?? DEFAULT_IGNORE_GLOBS,
    passThreshold: threshold ? Number(threshold) : DEFAULT_PASS_THRESHOLD,
  };
}

export function saveSettings(input: AppSettings): void {
  const s = settingsSchema.parse(input);
  writeSetting(Key.DefaultModel, s.defaultModelId === null ? "" : String(s.defaultModelId));
  writeSetting(Key.IgnoreGlobs, s.ignoreGlobs);
  writeSetting(Key.PassThreshold, String(s.passThreshold));
}

// --- prompts ---------------------------------------------------------------

// In pipeline order, as Settings lists them.
const PROMPT_INFO: { key: PromptKey; label: string; help: string }[] = [
  { key: PromptKey.Overview, label: "Change overview", help: "One call per review: summarizes the whole change for the per-file passes." },
  { key: PromptKey.Review, label: "Review", help: "Base instructions of every per-file pass. The JSON format is appended automatically." },
  { key: PromptKey.Bugs, label: "Bugs pass", help: "Added to Review for the built-in Bugs category." },
  { key: PromptKey.Rules, label: "Rules pass", help: "Added to Review for rule categories." },
  { key: PromptKey.Lookup, label: "Usage lookup", help: "Before the bugs pass: names what the diff changes, so its usages in other files can be shown." },
  { key: PromptKey.Usages, label: "Usages", help: "Added to the bugs pass when usages in other files were found." },
  { key: PromptKey.Describe, label: "Project description", help: "Drafts a project's description from its README, manifests and file tree." },
  { key: PromptKey.RuleChanges, label: "Rule changes", help: "Turns dismissed findings into proposed rule edits." },
];

export type PromptView = { key: PromptKey; label: string; help: string; text: string; defaultText: string };

export function listPrompts(): PromptView[] {
  return PROMPT_INFO.map((p) => ({ ...p, text: instruction(p.key), defaultText: PROMPT_DEFAULTS[p.key] }));
}

// Empty text, or the default itself, restores the default.
export function savePrompt(key: PromptKey, text: string): void {
  const k = z.enum(PromptKey).parse(key);
  const t = z.string().parse(text).trim();
  writeSetting(k, t === PROMPT_DEFAULTS[k] ? "" : t);
}
