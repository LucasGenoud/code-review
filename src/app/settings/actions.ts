"use server";

import { connection } from "next/server";
import { refresh } from "next/cache";
import * as providers from "@/server/services/providers";
import * as sandbox from "@/server/services/sandbox";
import * as settings from "@/server/services/settings";
import { attempt } from "../result";

// Settings API: LLM providers, models and app-wide review settings.

export type { AppSettings, PromptView, SandboxSettings } from "@/server/services/settings";
export type { SandboxStatus } from "@/lib/sandbox";
export type { Model, ModelInput, ProviderInput, ProviderView } from "@/server/services/providers";

export async function getSettings() {
  await connection();
  return settings.getSettings();
}

export async function saveSettings(input: settings.AppSettings) {
  const result = await attempt(() => settings.saveSettings(input));
  refresh();
  return result;
}

export async function listProviders() {
  await connection();
  return providers.listProviders();
}

// Models as "Provider / model" options for pickers.
export async function listModelOptions() {
  await connection();
  return providers.listProviders().flatMap((p) =>
    p.models.map((m) => ({ id: m.id, label: `${p.name} / ${m.name}` })),
  );
}

export async function saveProvider(input: providers.ProviderInput) {
  const result = await attempt(() => providers.saveProvider(input));
  refresh();
  return result;
}

export async function removeProvider(id: number) {
  providers.removeProvider(id);
  refresh();
}

export async function saveModel(input: providers.ModelInput) {
  const result = await attempt(() => providers.saveModel(input));
  refresh();
  return result;
}

export async function removeModel(id: number) {
  providers.removeModel(id);
  refresh();
}

// Sandbox runner state + on/off and timeout settings.
export async function getSandboxStatus() {
  await connection();
  return sandbox.sandboxStatus();
}

export async function saveSandboxSettings(input: settings.SandboxSettings) {
  const result = await attempt(() => settings.saveSandboxSettings(input));
  refresh();
  return result;
}

// Lists the provider's model ids; doubles as the connection test.
export async function fetchModelNames(providerId: number) {
  return attempt(() => providers.fetchModelNames(providerId));
}

export async function listPrompts() {
  await connection();
  return settings.listPrompts();
}

// Empty text restores the default.
export async function savePrompt(key: settings.PromptView["key"], text: string) {
  const result = await attempt(() => settings.savePrompt(key, text));
  refresh();
  return result;
}
