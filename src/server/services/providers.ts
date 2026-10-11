import { z } from "zod";
import { ProviderKind } from "@/lib/domain";
import { decrypt, encrypt } from "@/server/drivers/crypto";
import { listModelNames, type ModelConfig } from "@/server/drivers/llm";
import {
  allModels,
  allProviders,
  deleteModel,
  deleteProvider,
  insertModel,
  insertProvider,
  modelById,
  providerById,
  updateModel,
  updateProvider,
} from "@/server/drivers/providerStore";
import type { Model, Provider } from "@/server/drivers/schema";
import { InputError } from "./errors";
import { getSettings, saveSettings } from "./settings";

export type { Model };

const PER_MILLION = 1_000_000;

// Provider as the UI sees it: the API key never leaves the server.
export type ProviderView = Omit<Provider, "apiKey"> & { hasKey: boolean; models: Model[] };

export type ResolvedModel = { model: Model; config: ModelConfig; label: string };

const providerSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().trim().min(1),
  kind: z.enum(ProviderKind),
  baseUrl: z.string().trim().url().nullable(),
  // undefined = keep the stored key, "" = remove it.
  apiKey: z.string().optional(),
});

const modelSchema = z.object({
  id: z.number().int().optional(),
  providerId: z.number().int(),
  name: z.string().trim().min(1),
  contextWindow: z.number().int().min(1024),
  maxConcurrency: z.number().int().min(1).max(64),
  inputCost: z.number().min(0).nullable(),
  outputCost: z.number().min(0).nullable(),
  toolCalling: z.boolean(),
  jsonSchema: z.boolean(),
});

export type ProviderInput = z.input<typeof providerSchema>;
export type ModelInput = z.input<typeof modelSchema>;

export function listProviders(): ProviderView[] {
  const models = allModels();

  return allProviders().map(({ apiKey, ...p }) => ({
    ...p,
    hasKey: Boolean(apiKey),
    models: models.filter((m) => m.providerId === p.id),
  }));
}

export function saveProvider(input: ProviderInput): number {
  const { id, apiKey, ...fields } = providerSchema.parse(input);
  if (fields.kind === ProviderKind.Compatible && !fields.baseUrl) {
    throw new InputError("OpenAI-compatible providers need a base URL");
  }

  const key = apiKey === undefined ? {} : { apiKey: apiKey ? encrypt(apiKey) : null };

  if (id === undefined) {
    return insertProvider({ ...fields, ...key }).id;
  }

  updateProvider(id, { ...fields, ...key });
  return id;
}

export function removeProvider(id: number): void {
  deleteProvider(id);
  dropMissingDefault();
}

export function saveModel(input: ModelInput): number {
  const { id, ...fields } = modelSchema.parse(input);
  if (!providerById(fields.providerId)) {
    throw new InputError("Unknown provider");
  }

  if (id === undefined) {
    return insertModel(fields).id;
  }

  updateModel(id, fields);
  return id;
}

export function removeModel(id: number): void {
  deleteModel(id);
  dropMissingDefault();
}

// A deleted default model would make every review fail; fall back to none.
function dropMissingDefault(): void {
  const settings = getSettings();
  if (settings.defaultModelId === null || modelById(settings.defaultModelId)) {
    return;
  }

  saveSettings({ ...settings, defaultModelId: null });
}

// Lists the provider's models. Used as the "Test connection" check.
export async function fetchModelNames(providerId: number): Promise<string[]> {
  const p = providerById(providerId);
  if (!p) {
    throw new InputError("Unknown provider");
  }

  try {
    return await listModelNames(p.kind, p.baseUrl, p.apiKey ? decrypt(p.apiKey) : null);
  } catch (e) {
    throw new InputError(`Connection failed: ${(e as Error).message}`);
  }
}

// The model to use: the given one, else the global default.
export function resolveModel(modelId: number | null): ResolvedModel {
  const id = modelId ?? getSettings().defaultModelId;
  const model = id === null ? undefined : modelById(id);
  if (!model) {
    throw new InputError("No model configured. Add one in Settings.");
  }

  const p = providerById(model.providerId);
  if (!p) {
    throw new InputError("Model's provider was deleted");
  }

  return {
    model,
    label: `${p.name} / ${model.name}`,
    config: {
      kind: p.kind,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey ? decrypt(p.apiKey) : null,
      name: model.name,
      jsonSchema: model.jsonSchema,
    },
  };
}

// USD for token counts, or null when the model has no prices set.
export function tokenCost(modelId: number | null, input: number, output: number): number | null {
  const model = modelId === null ? undefined : modelById(modelId);
  if (model?.inputCost == null || model.outputCost == null) {
    return null;
  }

  return (input * model.inputCost + output * model.outputCost) / PER_MILLION;
}
