import path from "node:path";
import picomatch from "picomatch";
import { z } from "zod";
import { DiffMode } from "@/lib/domain";
import { blame, grepAt, log, showCommit, trackedFiles, wordUsages } from "@/server/drivers/git";
import { defineTool, type ChatTool } from "@/server/drivers/llm";
import { filesForReview } from "@/server/drivers/reviewStore";
import type { Project, Review } from "@/server/drivers/schema";
import { headContent } from "./diff";
import { parseDiff } from "./diffParse";
import { isInside } from "./paths";
import { locateCode } from "./retrieval";
import { keyFiles } from "./symbolIndex";
import { declarationEnd, definitionPattern, outline } from "./symbols";

// Read-only repository tools for the chat and the review agents, and the
// repository map they start from. Built for large codebases: every output
// is capped, and a cut output says how to narrow the next call, so the
// model converges in few calls instead of paging blindly.
//
//   repoMap ──► system prompt (where things are, no list_files needed)
//   locate ─► files ranked for a set of terms, with declarations, in one call
//   read_symbol ─► whole functions by name, several in one call
//   search / find_usages ─► grouped per file, capped, with "narrow with glob"
//   read_file ─► line ranges; a cut read names the next range

const MAX_FILE_LINES = 400;
const MAX_TOOL_LINES = 200;
// Files listed by list_files before it switches to directory counts.
const MAX_LISTED_FILES = 300;
// Names per read_symbol call, definitions per name and in all, lines per definition.
const MAX_SYMBOL_NAMES = 5;
const MAX_SYMBOLS = 3;
const MAX_SYMBOL_BLOCKS = 6;
const MAX_SYMBOL_LINES = 150;
// locate output, in characters.
const LOCATE_CHARS = 8_000;
const MAX_LOCATE_TERMS = 8;
const MAX_SEARCH_CONTEXT = 5;
// Files named in the tally of a cut search.
const TALLY_FILES = 6;
const DEFAULT_LOG_ENTRIES = 15;
const MAX_LOG_ENTRIES = 50;
// Lines blamed per call, and lines of a shown commit.
const MAX_BLAME_LINES = 200;
const MAX_SHOW_LINES = 400;
// Repository map: deepest directory level tried, and files listed in full
// when the repository is this small.
const MAX_MAP_DEPTH = 6;
const FULL_MAP_FILES = 150;
// Share of a large repository's map spent on key files.
const KEY_FILES_SHARE = 0.5;
const KEY_FILES_HEADING = "Key files (most depended on first, with their most used declarations):";
// e.g. 1e2c9e5, HEAD~2, v1.4: no leading dash, so never an option.
const COMMIT_REF = /^[\w.\/^~@{}][\w.\/^~@{}-]*$/;
// e.g. savePayment, $store, user_id.
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const NOT_FOUND = "Error: file not found or outside the repository. Check the path against the repository map, or use list_files.";

// What the tools read: the reviewed version of a review, else the working tree.
export type RepoView = { project: Project; review: Review | null };

export enum ToolScope {
  // Review agents: the reviewed version only.
  Review = "review",
  // Chat: also git history.
  Chat = "chat",
}

export function repoTools(view: RepoView, scope: ToolScope): Record<string, ChatTool> {
  const { project, review } = view;
  const sha = review?.headSha ?? null;
  const where = review ? "the reviewed version" : "the working tree";

  const tools: Record<string, ChatTool> = {
    read_file: defineTool({
      description: `Read a file of ${where}, with line numbers. Pass a line range for large files; a cut read tells you the next range. Call several at once for several files.`,
      input: z.object({
        path: z.string().describe("Path relative to the repository root"),
        startLine: z.number().int().min(1).nullable(),
        endLine: z.number().int().min(1).nullable(),
      }),
      run: async ({ path: file, startLine, endLine }) => {
        const content = await readRepoFile(view, file);
        if (content === null) {
          return NOT_FOUND;
        }

        const lines = content.split(/\r?\n/);
        const from = Math.min(startLine ?? 1, lines.length);
        const to = Math.min(endLine ?? lines.length, from + MAX_FILE_LINES - 1, lines.length);
        const body = numbered(lines.slice(from - 1, to), from);
        return to < (endLine ?? lines.length)
          ? `${body}\n… cut at line ${to} of ${lines.length}; continue with startLine ${to + 1}`
          : body;
      },
    }),
    locate: defineTool({
      description:
        "Find where a concept lives, in one call: ranks files by the terms they contain (content and path, rare terms weigh more) and returns the top files' declarations and matching lines with line numbers. Give the identifiers and words the code would use, synonyms included, e.g. [\"refund\", \"chargeback\", \"PaymentService\"]. Use it instead of chaining search, list_files and outline.",
      input: z.object({
        terms: z.array(z.string()).min(1).max(MAX_LOCATE_TERMS).describe("Case-insensitive substrings, at least 3 characters each"),
        glob: z.string().nullable().describe("Only files matching, e.g. src/server/**"),
      }),
      run: ({ terms, glob }) => locateCode(view, terms, glob, LOCATE_CHARS),
    }),
    read_symbol: defineTool({
      description:
        "Read the full declarations of functions, methods, classes or types by name: location and code, several names in one call. The fastest way to see how something works. Optionally limit to one file.",
      input: z.object({
        names: z.array(z.string().regex(IDENTIFIER)).min(1).max(MAX_SYMBOL_NAMES).describe("e.g. [\"savePayment\", \"Refund\"]"),
        path: z.string().nullable().describe("Only this file, when a name is common"),
      }),
      run: async ({ names, path: only }) => {
        const perName = Math.min(MAX_SYMBOLS, Math.max(1, Math.floor(MAX_SYMBOL_BLOCKS / names.length)));
        const found = await Promise.all(names.map((name) => symbolBlocks(view, name, only, perName)));
        return found.join("\n\n");
      },
    }),
    search: defineTool({
      description:
        "Search file contents with an extended regular expression (git grep -E). Returns path:line:text grouped by file. Narrow large searches with glob.",
      input: z.object({
        pattern: z.string().min(1),
        glob: z.string().nullable().describe("Pathspec, e.g. *.py or src/server/**"),
        context: z.number().int().min(0).max(MAX_SEARCH_CONTEXT).nullable().describe("Lines around each match"),
        ignoreCase: z.boolean().nullable(),
      }),
      run: async ({ pattern, glob, context, ignoreCase }) => {
        const out = await grepAt(project.path, pattern, sha, {
          glob: glob ?? undefined,
          context: context ?? 0,
          ignoreCase: ignoreCase ?? false,
        }).catch((e: unknown) => `Error: ${e instanceof Error ? e.message.split("\n")[0] : "search failed"}. Check the regex (POSIX ERE: no \\d, use [0-9]).`);
        return capMatches(out) || "(no matches)";
      },
    }),
    find_usages: defineTool({
      description: "Every line mentioning an identifier as a whole word, e.g. who calls a method or reads a field. Grouped by file.",
      input: z.object({
        identifier: z.string().min(1).describe("e.g. savePayment"),
        glob: z.string().nullable().describe("Pathspec, e.g. src/**"),
      }),
      run: async ({ identifier, glob }) => {
        const out = await wordUsages(project.path, identifier, sha, 0, glob ?? undefined);
        return capMatches(out) || "(no usages)";
      },
    }),
    outline: defineTool({
      description: "A file's declarations (classes, functions, methods) with line numbers: its structure without reading it.",
      input: z.object({ path: z.string().describe("Path relative to the repository root") }),
      run: async ({ path: file }) => {
        const content = await readRepoFile(view, file);
        if (content === null) {
          return NOT_FOUND;
        }

        return capLines(outline(content).join("\n")) || "(no declarations found)";
      },
    }),
    list_files: defineTool({
      description: "Files matching a glob, e.g. src/**/*.test.ts. Many matches are summarized as directory counts.",
      input: z.object({ glob: z.string().describe("e.g. src/payments/** or **/*config*") }),
      run: async ({ glob }) => {
        const isMatch = picomatch(glob, { dot: true });
        const matches = (await trackedFiles(project.path)).filter((f) => isMatch(f));
        if (matches.length === 0) {
          return "(no files)";
        }

        if (matches.length <= MAX_LISTED_FILES) {
          return matches.join("\n");
        }

        return `${matches.length} files; by directory:\n${capLines(directoryCounts(matches, MAX_MAP_DEPTH).join("\n"))}\nNarrow the glob to list files.`;
      },
    }),
  };

  if (scope === ToolScope.Chat) {
    tools.git_log = defineTool({
      description: "Recent commits, optionally for one file or since a date: who changed it, when, why.",
      input: z.object({
        path: z.string().nullable(),
        since: z.string().nullable().describe("e.g. 2026-10-01 or 3 weeks ago"),
        limit: z.number().int().min(1).max(MAX_LOG_ENTRIES).nullable(),
      }),
      run: async ({ path: file, since, limit }) => (await log(project.path, file ?? undefined, limit ?? DEFAULT_LOG_ENTRIES, since ?? undefined)) || "(no commits)",
    });
    tools.git_blame = defineTool({
      description: `Who last changed each line of a range, when, and the commit subjects: answers "why is this here". At most ${MAX_BLAME_LINES} lines.`,
      input: z.object({
        path: z.string().describe("Path relative to the repository root"),
        startLine: z.number().int().min(1),
        endLine: z.number().int().min(1),
      }),
      run: async ({ path: file, startLine, endLine }) => {
        const to = Math.min(endLine, startLine + MAX_BLAME_LINES - 1);
        return blame(project.path, file, startLine, to, sha).catch((e: unknown) => `Error: ${firstLine(e)}. Check the path and that the range exists.`);
      },
    });
    tools.git_show = defineTool({
      description: "A commit's full message, changed files and patch (from git_log or git_blame), optionally limited to one file.",
      input: z.object({
        commit: z.string().regex(COMMIT_REF).describe("e.g. 1e2c9e5 or HEAD~2"),
        path: z.string().nullable(),
      }),
      run: async ({ commit, path: file }) => {
        const out = await showCommit(project.path, commit, file ?? undefined);
        return out === null ? `Error: no commit ${commit}.` : capText(out, MAX_SHOW_LINES);
      },
    });
  }

  return tools;
}

// Up to `limit` declarations of `name`, then the locations of the rest.
async function symbolBlocks(view: RepoView, name: string, only: string | null, limit: number): Promise<string> {
  const out = await grepAt(view.project.path, definitionPattern(name), view.review?.headSha ?? null, { glob: only ?? undefined });
  const hits = out.split("\n").filter(Boolean);
  if (hits.length === 0) {
    return `No declaration of ${name} found. Try find_usages or locate to see where it appears.`;
  }

  const blocks = await Promise.all(hits.slice(0, limit).map((hit) => symbolBlock(view, hit)));
  const more = hits.length > limit ? `\n\n… ${hits.length - limit} more declarations of ${name}: ${hits.slice(limit).map(location).join(", ")}` : "";
  return blocks.join("\n\n") + more;
}

// "src/pay.ts:40-62\n40   export function pay(…) {…" for one definition hit.
async function symbolBlock(view: RepoView, hit: string): Promise<string> {
  const [file, lineText] = hit.split(":");
  const line = Number(lineText);
  const content = await readRepoFile(view, file);
  if (content === null || !Number.isInteger(line)) {
    return hit;
  }

  const end = declarationEnd(content, line, MAX_SYMBOL_LINES);
  const lines = content.split(/\r?\n/).slice(line - 1, end);
  return `${file}:${line}-${end}\n${numbered(lines, line)}`;
}

// "src/pay.ts:40:export function pay(" → "src/pay.ts:40".
function location(hit: string): string {
  return hit.split(":").slice(0, 2).join(":");
}

// Paths come from the model: keep them inside the repository.
export async function readRepoFile(view: RepoView, file: string): Promise<string | null> {
  const { project, review } = view;
  if (review?.mode === DiffMode.Pasted) {
    return pastedContent(review, file);
  }

  const absolute = path.resolve(project.path, file);
  if (!isInside(project.path, absolute)) {
    return null;
  }

  const relative = path.relative(project.path, absolute).split(path.sep).join("/");
  return headContent(project.path, review?.headSha ?? null, relative);
}

// A pasted file, rebuilt from its whole-file patch.
function pastedContent(review: Review, file: string): string | null {
  const row = filesForReview(review.id).find((f) => f.path === file);
  const parsed = row && parseDiff(row.patch)[0];
  if (!parsed) {
    return null;
  }

  return parsed.hunks.flatMap((h) => h.lines.map((l) => l.text)).join("\n");
}

// --- repository map --------------------------------------------------------

// The repository's layout within `budget` characters, for system prompts:
// every file when small, else the key files (see symbolIndex) and
// directories with file counts, as deep as fit.
//   Key files (…):
//   src/money.ts: Money, Currency
//
//   Layout: 412 files
//   src/ (412)
//     server/ (120)
//   package.json
export async function repoMap(view: RepoView, budget: number): Promise<string> {
  const files = await trackedFiles(view.project.path).catch(() => []);
  if (files.length === 0) {
    return "(no tracked files)";
  }

  if (files.length <= FULL_MAP_FILES) {
    const full = files.join("\n");
    if (full.length <= budget) {
      return full;
    }
  }

  const key = await keyFiles(view.project.path, Math.floor(budget * KEY_FILES_SHARE)).catch(() => "");
  const head = key ? `${KEY_FILES_HEADING}\n${key}\n\nLayout: ` : "";
  const room = budget - head.length;

  for (let depth = MAX_MAP_DEPTH; depth >= 1; depth--) {
    const map = `${files.length} files\n${directoryCounts(files, depth).join("\n")}`;
    if (map.length <= room) {
      return head + map;
    }
  }

  return head + `${files.length} files\n${directoryCounts(files, 1).join("\n")}`.slice(0, room);
}

// Indented directories down to `depth`, with file counts, then root files.
function directoryCounts(files: string[], depth: number): string[] {
  const counts = new Map<string, number>();
  const rootFiles: string[] = [];

  for (const f of files) {
    const parts = f.split("/");
    if (parts.length === 1) {
      rootFiles.push(f);
      continue;
    }

    for (let d = 1; d < parts.length && d <= depth; d++) {
      const dir = parts.slice(0, d).join("/");
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
  }

  const dirs = [...counts].sort(([a], [b]) => a.localeCompare(b));
  const lines = dirs.map(([dir, n]) => {
    const parts = dir.split("/");
    return `${"  ".repeat(parts.length - 1)}${parts.at(-1)}/ (${n})`;
  });
  return [...lines, ...rootFiles];
}

// --- output caps -----------------------------------------------------------

function numbered(lines: string[], first: number): string {
  return lines.map((l, i) => `${first + i}: ${l}`).join("\n");
}

// The first `max` lines of `text`, blank lines kept (a patch needs them).
function capText(text: string, max: number): string {
  const lines = text.split("\n");
  return lines.length <= max ? text : `${lines.slice(0, max).join("\n")}\n… ${lines.length - max} more lines; pass path to see one file`;
}

function firstLine(e: unknown): string {
  return e instanceof Error ? e.message.split("\n")[0] : "git failed";
}

function capLines(text: string): string {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length <= MAX_TOOL_LINES) {
    return lines.join("\n");
  }

  return [...lines.slice(0, MAX_TOOL_LINES), `… ${lines.length - MAX_TOOL_LINES} more lines`].join("\n");
}

// grep output cut to MAX_TOOL_LINES, then a per-file tally of the rest:
//   "… 340 more matches in 52 files (src/a.ts 30, src/b.ts 12, …). Narrow with glob."
function capMatches(text: string): string {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length <= MAX_TOOL_LINES) {
    return lines.join("\n");
  }

  const rest = lines.slice(MAX_TOOL_LINES).filter((l) => l !== "--");
  const perFile = new Map<string, number>();
  for (const l of rest) {
    const file = /^(.+?)[:-]\d+[:-]/.exec(l)?.[1] ?? "?";
    perFile.set(file, (perFile.get(file) ?? 0) + 1);
  }

  const top = [...perFile].sort((a, b) => b[1] - a[1]).slice(0, TALLY_FILES).map(([f, n]) => `${f} ${n}`);
  return `${lines.slice(0, MAX_TOOL_LINES).join("\n")}\n… ${rest.length} more lines in ${perFile.size} files (${top.join(", ")}, …). Narrow with glob or a more specific pattern.`;
}
