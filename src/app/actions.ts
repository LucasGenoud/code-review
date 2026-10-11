"use server";

import { connection } from "next/server";
import { refresh } from "next/cache";
import { browse, type Listing } from "@/server/services/folders";
import * as projects from "@/server/services/projects";
import { listReviews as reviewsOf } from "@/server/services/reviews";
import { startReview as start } from "@/server/services/review/engine";
import type { DiffSource } from "@/server/services/diff";
import { attempt } from "./result";

// Projects and reviews API. Reads await connection() to stay out of
// build-time prerendering; mutations return a Result and refresh the UI.

export type { Listing };
export type { Result } from "./result";
export type { CommitInfo, LanguageUsage, Project, ProjectRefs, ProjectSettings } from "@/server/services/projects";
export type { ReviewSummary } from "@/server/services/reviews";
export type { DiffSource };

export async function listProjects() {
  await connection();
  return projects.listProjects();
}

export async function getProject(id: number) {
  await connection();
  return { project: projects.getProject(id), describing: projects.isDescribing(id) };
}

export async function projectRefs(id: number) {
  await connection();
  return projects.projectRefs(id);
}

export async function projectLanguages(id: number) {
  await connection();
  return projects.projectLanguages(id);
}

export async function listReviews(projectId: number) {
  await connection();
  return reviewsOf(projectId);
}

export async function browseFolders(dir?: string) {
  return attempt(() => browse(dir));
}

export async function addProject(dir: string) {
  const result = await attempt(() => projects.addProject(dir));
  refresh();
  return result;
}

export async function removeProject(id: number) {
  projects.removeProject(id);
  refresh();
}

export async function saveProjectSettings(id: number, input: projects.ProjectSettings) {
  const result = await attempt(() => projects.saveProjectSettings(id, input));
  refresh();
  return result;
}

// Regenerates the project description with the LLM. Takes seconds.
export async function describeProject(id: number) {
  const result = await attempt(() => projects.describeProject(id));
  refresh();
  return result;
}

// Starts a review in the background; returns its id right away.
export async function startReview(projectId: number, source: DiffSource) {
  const result = await attempt(() => start(projectId, source));
  refresh();
  return result;
}
