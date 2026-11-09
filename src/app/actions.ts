"use server";

import { connection } from "next/server";
import { refresh } from "next/cache";
import * as chat from "@/server/services/chat";
import { browse, type Listing } from "@/server/services/folders";
import * as projects from "@/server/services/projects";
import * as semantic from "@/server/services/semanticIndex";
import { listReviews as reviewsOf } from "@/server/services/reviews";
import { startReview as start } from "@/server/services/review/engine";
import type { DiffSource, PastedFile } from "@/server/services/diff";
import { attempt } from "./result";

// Projects and reviews API. Reads await connection() to stay out of
// build-time prerendering; mutations return a Result and refresh the UI.

export type { Listing };
export type { Result } from "./result";
export type { ChangedFile, CommitInfo, LanguageUsage, Project, ProjectRefs, ProjectSettings } from "@/server/services/projects";
export type { ReviewSummary } from "@/server/services/reviews";
export type { ChatModelInfo, ThreadSummary } from "@/server/services/chat";
export type { SemanticStatus } from "@/lib/semantic";
export type { DiffSource, PastedFile };

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

// Commits for the commit pickers: one branch, or all branches when null.
export async function listCommits(id: number, branch: string | null) {
  return attempt(() => projects.projectCommits(id, branch));
}

// Files of the working tree, for picking what a Files review covers.
export async function listFiles(id: number) {
  return attempt(() => projects.projectFiles(id));
}

// Files a commit range changes, for picking what its review covers.
export async function listRangeFiles(id: number, source: DiffSource) {
  return attempt(() => projects.projectRangeFiles(id, source));
}

// Codebase Q&A history, most recent first.
export async function listCodebaseThreads(projectId: number) {
  await connection();
  return chat.listThreads(projectId);
}

export async function loadCodebaseThread(projectId: number, threadId: number) {
  await connection();
  return chat.loadThread(projectId, threadId);
}

export async function codebaseChatModel(projectId: number) {
  await connection();
  return chat.codebaseModel(projectId);
}

// Creates the conversation a first question goes to.
export async function startCodebaseThread(projectId: number, question: string) {
  return attempt(() => chat.startThread(projectId, question));
}

export async function renameCodebaseThread(projectId: number, threadId: number, title: string) {
  const result = await attempt(() => chat.renameCodebaseThread(projectId, threadId, title));
  refresh();
  return result;
}

export async function deleteCodebaseThread(projectId: number, threadId: number) {
  const result = await attempt(() => chat.removeThread(projectId, threadId));
  refresh();
  return result;
}

// A file cited in an answer. Read-only.
export async function readCodebaseFile(projectId: number, path: string) {
  return attempt(() => chat.codebaseFile(projectId, path));
}

// Summarizes the conversation to free the context window. Takes seconds.
export async function compactCodebaseThread(projectId: number, threadId: number) {
  return attempt(() => chat.compactThread(projectId, threadId));
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
// ruleIds: exactly these rules; null = the project's enabled rules.
// pasted: the files of a Pasted review.
export async function startReview(projectId: number, source: DiffSource, ruleIds: number[] | null, pasted: PastedFile[] = []) {
  const result = await attempt(() => start(projectId, source, ruleIds, pasted));
  refresh();
  return result;
}

// Semantic search index of a project: status (polled while building),
// build or update, stop, delete.
export async function semanticStatus(id: number) {
  await connection();
  return semantic.semanticStatus(id);
}

export async function buildSemanticIndex(id: number) {
  return attempt(() => semantic.buildSemanticIndex(id));
}

export async function stopSemanticIndex(id: number) {
  semantic.stopSemanticIndex(id);
}

export async function removeSemanticIndex(id: number) {
  semantic.removeSemanticIndex(id);
  refresh();
}
