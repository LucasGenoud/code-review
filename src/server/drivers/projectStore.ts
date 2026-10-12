import { asc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { projects, type Project } from "./schema";

export type ProjectPatch = Partial<
  Pick<Project, "description" | "ignoreGlobs" | "modelId" | "ruleSetId">
>;

export function allProjects(): Project[] {
  return getDb().select().from(projects).orderBy(asc(projects.name)).all();
}

export function projectById(id: number): Project | undefined {
  return getDb().select().from(projects).where(eq(projects.id, id)).get();
}

export function projectByPath(dir: string): Project | undefined {
  return getDb().select().from(projects).where(eq(projects.path, dir)).get();
}

export function insertProject(name: string, dir: string): Project {
  return getDb().insert(projects).values({ name, path: dir }).returning().get();
}

export function updateProject(id: number, patch: ProjectPatch): void {
  getDb().update(projects).set(patch).where(eq(projects.id, id)).run();
}

export function deleteProject(id: number): void {
  getDb().delete(projects).where(eq(projects.id, id)).run();
}
