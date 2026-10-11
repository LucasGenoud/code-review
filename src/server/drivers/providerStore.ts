import { asc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { models, providers, type Model, type Provider } from "./schema";

export type ProviderInput = Omit<typeof providers.$inferInsert, "id" | "createdAt">;
export type ModelInput = Omit<typeof models.$inferInsert, "id">;

export function allProviders(): Provider[] {
  return getDb().select().from(providers).orderBy(asc(providers.name)).all();
}

export function providerById(id: number): Provider | undefined {
  return getDb().select().from(providers).where(eq(providers.id, id)).get();
}

export function insertProvider(input: ProviderInput): Provider {
  return getDb().insert(providers).values(input).returning().get();
}

export function updateProvider(id: number, input: Partial<ProviderInput>): void {
  getDb().update(providers).set(input).where(eq(providers.id, id)).run();
}

export function deleteProvider(id: number): void {
  getDb().delete(providers).where(eq(providers.id, id)).run();
}

export function allModels(): Model[] {
  return getDb().select().from(models).orderBy(asc(models.name)).all();
}

export function modelById(id: number): Model | undefined {
  return getDb().select().from(models).where(eq(models.id, id)).get();
}

export function insertModel(input: ModelInput): Model {
  return getDb().insert(models).values(input).returning().get();
}

export function updateModel(id: number, input: Partial<ModelInput>): void {
  getDb().update(models).set(input).where(eq(models.id, id)).run();
}

export function deleteModel(id: number): void {
  getDb().delete(models).where(eq(models.id, id)).run();
}
