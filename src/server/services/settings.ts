import { z } from "zod";
import { readSetting, writeSetting } from "@/server/drivers/settingStore";

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
