import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ProviderKind } from "@/lib/domain";

it("clears the default model when that model is deleted", async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "prr-providers-"));
  const providers = await import("./providers");
  const settings = await import("./settings");

  const providerId = providers.saveProvider({ name: "P", kind: ProviderKind.OpenAI, baseUrl: null });
  const modelId = providers.saveModel({
    providerId,
    name: "m",
    contextWindow: 8000,
    maxConcurrency: 1,
    inputCost: null,
    outputCost: null,
    toolCalling: true,
    jsonSchema: true,
  });
  settings.saveSettings({ ...settings.getSettings(), defaultModelId: modelId });

  providers.removeModel(modelId);
  expect(settings.getSettings().defaultModelId).toBeNull();
});
