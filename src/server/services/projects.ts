import path from "node:path";
import { z } from "zod";
import { readBytes } from "@/server/drivers/fs";
import {
  branches,
  changedFiles,
  commits,
  currentBranch,
  repoRoot,
  trackedFiles,
  type ChangedFile,
  type CommitInfo,
} from "@/server/drivers/git";
import { generatePlain } from "@/server/drivers/llm";
import {
  allProjects,
  deleteProject,
  insertProject,
  projectById,
  projectByPath,
  updateProject,
} from "@/server/drivers/projectStore";
import type { Project } from "@/server/drivers/schema";
import { InputError } from "./errors";
import { resolveInRoot } from "./paths";
import { resolveModel } from "./providers";
import { describePrompt, DESCRIBE_INSTRUCTIONS } from "./review/prompts";
import { languageUsage, type LanguageUsage } from "./rules";

export type { ChangedFile, CommitInfo, LanguageUsage, Project };

// changes: uncommitted files, shown before reviewing local changes.
export type ProjectRefs = { branches: string[]; current: string | null; commits: CommitInfo[]; changes: ChangedFile[] };

const RECENT_COMMITS = 50;

// Material for the auto description, capped to keep the prompt small.
const MAX_TREE_FILES = 300;
const MAX_README_CHARS = 6000;
const MAX_MANIFEST_CHARS = 3000;
const README = /^readme(\.\w+)?$/i;
const MANIFESTS = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "Gemfile",
  "Dockerfile",
  "docker-compose.yml",
  "tsconfig.json",
]);

const describing = new Set<number>();

const settingsSchema = z.object({
  description: z.string(),
  ignoreGlobs: z.string(),
  modelId: z.number().int().nullable(),
});

export type ProjectSettings = z.input<typeof settingsSchema>;

export function listProjects(): Project[] {
  return allProjects();
}

export function getProject(id: number): Project {
  const p = projectById(id);
  if (!p) {
    throw new InputError("Unknown project");
  }

  return p;
}

// Registers the git repo containing `dir`. Adding a subfolder adds its repo.
// Drafts a description in the background when a model is configured.
export async function addProject(dir: string): Promise<Project> {
  const target = await resolveInRoot(dir);

  const top = await repoRoot(target);
  if (!top) {
    throw new InputError("Not a git repository");
  }

  // Re-check: the repo root may sit above REPO_ROOT.
  const repo = await resolveInRoot(top);
  if (projectByPath(repo)) {
    throw new InputError("Project already added");
  }

  const project = insertProject(path.basename(repo), repo);
  describeProject(project.id).catch((e) => console.error(`Describe project ${project.id} failed`, e));
  return project;
}

// Forgets the project. Files on disk are untouched.
export function removeProject(id: number): void {
  if (!Number.isInteger(id)) {
    throw new InputError("Invalid project id");
  }

  deleteProject(id);
}

export function saveProjectSettings(id: number, input: ProjectSettings): void {
  getProject(id);
  updateProject(id, settingsSchema.parse(input));
}

export async function projectRefs(id: number): Promise<ProjectRefs> {
  const p = getProject(id);
  const [list, current, recent, changes] = await Promise.all([
    branches(p.path),
    currentBranch(p.path),
    commits(p.path, RECENT_COMMITS, null),
    changedFiles(p.path),
  ]);
  return { branches: list, current, commits: recent, changes };
}

// Recent commits on one branch, or on all branches when null.
export async function projectCommits(id: number, branch: string | null): Promise<CommitInfo[]> {
  const p = getProject(id);
  // Only known branches reach git, e.g. never "--output=x".
  if (branch !== null && !(await branches(p.path)).includes(branch)) {
    throw new InputError(`Unknown branch: ${branch}`);
  }

  return commits(p.path, RECENT_COMMITS, branch);
}

// Language packs and how many tracked files each covers in this project.
export async function projectLanguages(id: number): Promise<LanguageUsage[]> {
  const p = getProject(id);
  return languageUsage(id, await trackedFiles(p.path));
}

export function isDescribing(id: number): boolean {
  return describing.has(id);
}

// Asks the LLM for a project description from the README, manifests and
// file tree. Overwrites the current description.
export async function describeProject(id: number): Promise<string> {
  const project = getProject(id);
  const model = resolveModel(project.modelId);
  if (describing.has(id)) {
    throw new InputError("Already generating");
  }

  describing.add(id);
  try {
    const files = await trackedFiles(project.path);
    const tree = files.slice(0, MAX_TREE_FILES).join("\n");

    const docs: { file: string; text: string }[] = [];
    for (const file of files.filter((f) => !f.includes("/"))) {
      const limit = README.test(file) ? MAX_README_CHARS : MANIFESTS.has(file) ? MAX_MANIFEST_CHARS : 0;
      if (!limit) {
        continue;
      }

      const bytes = await readBytes(path.join(project.path, file));
      if (bytes) {
        docs.push({ file, text: bytes.toString("utf8").slice(0, limit) });
      }
    }

    const { text } = await generatePlain(model.config, {
      instructions: DESCRIBE_INSTRUCTIONS,
      prompt: describePrompt(project.name, tree, docs),
    });

    const description = text.trim();
    updateProject(id, { description });
    return description;
  } finally {
    describing.delete(id);
  }
}
