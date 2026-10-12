import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, expect, it } from "vitest";
import { instruction, PROMPT_DEFAULTS, PromptKey } from "./review/prompts";

beforeAll(() => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "prr-settings-"));
});

it("saves, lists and resets an edited prompt", async () => {
  const settings = await import("./settings");
  const view = () => settings.listPrompts().find((p) => p.key === PromptKey.Bugs)!;

  settings.savePrompt(PromptKey.Bugs, "  Only report crashes.  ");
  expect(instruction(PromptKey.Bugs)).toBe("Only report crashes.");
  expect(view()).toMatchObject({ text: "Only report crashes.", defaultText: PROMPT_DEFAULTS[PromptKey.Bugs] });

  // Empty text, or the default itself, restores the default.
  settings.savePrompt(PromptKey.Bugs, "");
  expect(instruction(PromptKey.Bugs)).toBe(PROMPT_DEFAULTS[PromptKey.Bugs]);
  settings.savePrompt(PromptKey.Bugs, `${PROMPT_DEFAULTS[PromptKey.Bugs]}\n`);
  expect(view().text).toBe(view().defaultText);

  expect(() => settings.savePrompt("prompt_nope" as PromptKey, "x")).toThrow();
});
