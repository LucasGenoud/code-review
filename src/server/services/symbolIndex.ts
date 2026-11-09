import path from "node:path";
import { readBytes } from "@/server/drivers/fs";
import { changedFiles, fileBlobs } from "@/server/drivers/git";
import { isTestPath } from "./paths";
import { declarations } from "./symbols";

// Which files the rest of the codebase depends on, for the repository map
// and as a ranking prior. Per project: the declarations of each code file
// and the declared names each file mentions, as a graph ranked with
// PageRank (as in Aider's repository map):
//
//   order.xhtml ──"orderBean"──► OrderBean.java ──"Money"──► Money.java
//   pay.ts ───────"Money"───────────────────────────────────┘
//   rank: Money.java > OrderBean.java > …
//
// Built from the working tree in the background, then refreshed
// incrementally: files whose blob id is unchanged aren't read again.
// Regex declarations, not a parser: names declared in many files (save,
// get, name) are left out of the graph, they say nothing about structure.

// Declarations come from code; references also from templates and config,
// e.g. JSF facelets naming beans in EL (#{orderBean.total}).
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|py|java|kt|kts|scala|groovy|cs|go|rs|rb|php|swift|c|h|cc|cpp|hpp|m|mm|dart|lua|ex|exs|vue|svelte)$/i;
const MARKUP = /\.(xhtml|jsp|jspx|jsf|html|xml|properties|yml|yaml)$/i;
const MAX_FILE_BYTES = 512 * 1024;
const READ_CONCURRENCY = 32;
// A name declared in more files than this links nothing.
const MAX_DEFINERS = 5;
const MIN_NAME_LENGTH = 3;
// A lowercase name this long is specific enough to link, e.g. serialize;
// a compound one this long weighs COMPOUND_WEIGHT links.
const LONG_NAME = 8;
const COMPOUND_WEIGHT = 10;
const WORD = /[A-Za-z_$][A-Za-z0-9_$]*/g;
// Comments and string literals of code: their words are prose, not uses.
// Markup keeps its strings, where EL lives (value="#{cart.total}").
const PROSE = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|(^|\s)#[^\n{]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g;
const MARKUP_COMMENT = /<!--[\s\S]*?-->/g;
// Generated and vendored code: copies of declarations that aren't the project's.
const GENERATED = /(^|\/)(generated|vendor|third_party|dist)\/|\.generated\.|\.min\./;
// Keywords long enough to pass as names: readonly, implements, …
const KEYWORDS = new Set("readonly implements abstract override function continue protected internal volatile transient synchronized instanceof namespace unsigned explicit operator template typename register nonlocal interface extends".split(" "));
// Explicit bean names: @Named("cart"), @ManagedBean(name = "cart"), @Component("cart").
const BEAN_NAME = /@(?:Named|ManagedBean|Component|Service|Controller|Repository)\s*\(\s*(?:(?:value|name)\s*=\s*)?"([\w.$]+)"/g;
const DAMPING = 0.85;
const ITERATIONS = 20;
// Refreshed at most this often; a turn waits at most WAIT_MS for it.
const REFRESH_MS = 10_000;
const WAIT_MS = 1_500;
const NAMES_PER_FILE = 6;

type FileEntry = {
  // Blob id, or null for a file changed in the working tree (re-read each refresh).
  blob: string | null;
  declared: string[];
  // Declared names the file mentions, its own included.
  mentions: string[];
};

export type RankedFile = { file: string; score: number; names: string[] };

type Index = {
  files: Map<string, FileEntry>;
  ranked: RankedFile[] | null;
  refreshedAt: number;
  refreshing: Promise<void> | null;
};

// Survives dev hot reloads.
const cache = globalThis as unknown as { symbolIndexes?: Map<string, Index> };
const indexes = (cache.symbolIndexes ??= new Map());

// Files of the repository at `dir`, most depended on first; null while the
// first build takes longer than WAIT_MS (the next call will have it).
export async function rankedFiles(dir: string): Promise<RankedFile[] | null> {
  const index = indexFor(dir);
  if (Date.now() - index.refreshedAt > REFRESH_MS) {
    index.refreshing ??= refresh(dir, index).finally(() => {
      index.refreshing = null;
    });
  }

  if (index.refreshing) {
    await Promise.race([index.refreshing, new Promise((r) => setTimeout(r, WAIT_MS))]);
  }

  return index.ranked;
}

// The most depended-on files with their most used declarations, within
// `budget` characters; "" until the index exists.
//   src/money.ts: Money, Currency, round
export async function keyFiles(dir: string, budget: number): Promise<string> {
  const ranked = await rankedFiles(dir);
  const lines: string[] = [];
  let used = 0;

  for (const r of ranked ?? []) {
    const line = r.names.length > 0 ? `${r.file}: ${r.names.join(", ")}` : r.file;
    if (used + line.length + 1 > budget) {
      break;
    }

    lines.push(line);
    used += line.length + 1;
  }

  return lines.join("\n");
}

function indexFor(dir: string): Index {
  let index = indexes.get(dir);
  if (!index) {
    index = { files: new Map(), ranked: null, refreshedAt: 0, refreshing: null };
    indexes.set(dir, index);
  }

  return index;
}

// Re-reads new and changed files, drops deleted ones, re-ranks. Files not
// re-read keep their mentions: a newly declared name links from them once
// they change.
async function refresh(dir: string, index: Index): Promise<void> {
  const [blobs, changed] = await Promise.all([fileBlobs(dir), changedFiles(dir).catch(() => [])]);
  const dirty = new Set(changed.map((c) => c.path));
  const wanted = [...blobs.keys()].filter((f) => CODE.test(f) || MARKUP.test(f));

  for (const file of index.files.keys()) {
    if (!blobs.has(file)) {
      index.files.delete(file);
    }
  }

  const stale = wanted.filter((f) => dirty.has(f) || index.files.get(f)?.blob !== blobs.get(f));

  // Pass 1: declarations of new and changed files. Tests and fixtures
  // declare helpers nothing else depends on.
  const fresh: string[] = [];
  await eachLimited(stale, READ_CONCURRENCY, async (file) => {
    const text = await readText(dir, file);
    if (text === null) {
      index.files.delete(file);
      return;
    }

    const declared = CODE.test(file) && !isTestPath(file) && !GENERATED.test(file) ? declaredNames(text) : [];
    index.files.set(file, { blob: dirty.has(file) ? null : (blobs.get(file) ?? null), declared, mentions: [] });
    fresh.push(file);
  });

  // Pass 2: the declared names they mention. Reading again holds one file's
  // vocabulary in memory at a time instead of the whole repository's.
  const declaredBy = definers(index.files);
  await eachLimited(fresh, READ_CONCURRENCY, async (file) => {
    const text = (await readText(dir, file)) ?? "";
    const words = new Set((CODE.test(file) ? text.replace(PROSE, " ") : text.replace(MARKUP_COMMENT, " ")).match(WORD) ?? []);
    index.files.get(file)!.mentions = [...words].filter((w) => declaredBy.has(w));
  });

  index.ranked = rank(index.files, declaredBy);
  index.refreshedAt = Date.now();
}

async function readText(dir: string, file: string): Promise<string | null> {
  const bytes = await readBytes(path.join(dir, file));
  return bytes && bytes.length <= MAX_FILE_BYTES ? bytes.toString("utf8") : null;
}

// Declared names worth linking, plus the name EL and dependency injection
// use for a class: class OrderBean → orderBean; @Named("cart") → cart.
function declaredNames(text: string): string[] {
  const names = declarations(text).map((d) => d.name).filter(isDistinctive);
  const beans = [...text.matchAll(BEAN_NAME)].map((m) => m[1]);
  const aliases = names.filter((n) => /^[A-Z]/.test(n)).map((n) => n[0].toLowerCase() + n.slice(1));
  return [...new Set([...names, ...aliases, ...beans])];
}

// Name → files declaring it.
function definers(files: Map<string, FileEntry>): Map<string, Set<string>> {
  const by = new Map<string, Set<string>>();
  for (const [file, entry] of files) {
    for (const name of entry.declared) {
      let set = by.get(name);
      if (!set) {
        set = new Set();
        by.set(name, set);
      }

      set.add(file);
    }
  }

  return by;
}

// PageRank over "mentions a name declared in", weighted by nameWeight: a
// file many files rely on, directly or through other relied-on files, ranks
// high. Each file's names are its declarations sorted by weighted mentions
// from other files, without aliases (orderBean when OrderBean is listed).
function rank(files: Map<string, FileEntry>, declaredBy: Map<string, Set<string>>): RankedFile[] {
  const nodes = [...files.keys()];
  const at = new Map(nodes.map((f, i) => [f, i]));
  const edges: Map<number, number>[] = nodes.map(() => new Map());
  const mentionedBy = new Map<string, number>();

  nodes.forEach((file, i) => {
    for (const name of files.get(file)!.mentions) {
      const defs = declaredBy.get(name);
      if (!defs || defs.size > MAX_DEFINERS || defs.has(file)) {
        continue;
      }

      mentionedBy.set(name, (mentionedBy.get(name) ?? 0) + nameWeight(name));
      for (const d of defs) {
        const j = at.get(d)!;
        edges[i].set(j, (edges[i].get(j) ?? 0) + nameWeight(name) / defs.size);
      }
    }
  });

  const n = Math.max(nodes.length, 1);
  let score = new Array<number>(nodes.length).fill(1 / n);
  for (let k = 0; k < ITERATIONS; k++) {
    const next = new Array<number>(nodes.length).fill((1 - DAMPING) / n);
    let dangling = 0;

    edges.forEach((out, i) => {
      const total = [...out.values()].reduce((a, b) => a + b, 0);
      if (total === 0) {
        dangling += score[i];
        return;
      }

      for (const [j, w] of out) {
        next[j] += (DAMPING * score[i] * w) / total;
      }
    });

    score = next.map((v) => v + (DAMPING * dangling) / n);
  }

  return nodes
    .map((file, i) => {
      const declared = new Set(files.get(file)!.declared);
      // A class counts the mentions of its alias: #{orderBean} uses OrderBean.
      const uses = (name: string) => {
        const own = mentionedBy.get(name) ?? 0;
        return /^[A-Z]/.test(name) ? own + (mentionedBy.get(name[0].toLowerCase() + name.slice(1)) ?? 0) : own;
      };
      const names = [...declared]
        .filter((name) => uses(name) > 0 && !isAlias(name, declared))
        .sort((a, b) => uses(b) - uses(a))
        .slice(0, NAMES_PER_FILE);
      return { file, score: score[i], names };
    })
    .sort((a, b) => b.score - a.score);
}

// Long compound names (ConfigurationChangedEvent, add_listener) say far more
// about a dependency than single words (Value, Result), as in Aider.
function nameWeight(name: string): number {
  return name.length >= LONG_NAME && /.[A-Z]|_/.test(name) ? COMPOUND_WEIGHT : 1;
}

// Names that identify code rather than read as words: OrderBean, getUser,
// MAX_SIZE, utf8, serialize. Plain words (save, and, true, upload) also
// appear in comments and prose, linking unrelated files.
function isDistinctive(name: string): boolean {
  if (name.length < MIN_NAME_LENGTH || KEYWORDS.has(name)) {
    return false;
  }

  return /^[A-Z]|[A-Z_$0-9]/.test(name) || name.length >= LONG_NAME;
}

// orderBean when OrderBean is declared too.
function isAlias(name: string, declared: Set<string>): boolean {
  return /^[a-z]/.test(name) && declared.has(name[0].toUpperCase() + name.slice(1));
}

async function eachLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      await run(items[next++]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
