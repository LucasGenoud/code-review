import picomatch from "picomatch";
import { matchCounts, trackedFiles } from "@/server/drivers/git";
import { isTestPath } from "./paths";
import { readRepoFile, type RepoView } from "./repoTools";
import { rankedFiles } from "./symbolIndex";
import { outline } from "./symbols";

// Finds the code a question is about before the model spends tool calls
// looking for it. Ranks files by the question's terms, BM25-style, then
// shows the top files' declarations and matching lines, so the model can
// go straight to read_symbol or a line range.
//
//   "How are API keys encrypted?"
//     └─ terms: encrypt, keys→key, api
//          └─ one git grep -c per term ─► BM25 + path and declaration boosts
//               └─ top files: declarations and hits, with line numbers
//
// Lexical and index-free: fast on large repositories, needs no embedding
// model. Misses synonyms; the locate tool lets the model retry with the
// code's own vocabulary.

const MAX_TERMS = 8;
const MIN_TERM_LENGTH = 3;
// BM25 term-frequency saturation and length normalization, against files
// of AVERAGE_FILE_LINES.
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const AVERAGE_FILE_LINES = 250;
// Extra weight of a term found in the file name, in a directory name, and
// in a declaration line. A file named after the concept is usually its home,
// e.g. "terminal link detect" → terminalLinkDetector.ts.
const NAME_WEIGHT = 3;
const DIRECTORY_WEIGHT = 1;
const DECLARATION_WEIGHT = 1.5;
// Tests and fixtures explain less than the code they exercise.
const TEST_FACTOR = 0.6;
// Tie-breaker for files the codebase depends on (see symbolIndex): at most
// this much, for the most depended-on file.
const IMPORTANCE_WEIGHT = 2;
// A path the question names outranks every term match, unless the name is
// too common to point at one file, e.g. "settings.json" in a monorepo.
const MENTION_SCORE = 1_000;
const MAX_MENTIONED = 3;
// Files re-ranked by content, and further files named after the shown ones.
const RERANK_FILES = 40;
const LISTED_FILES = 12;
// Per shown file.
const MAX_DECLARATIONS = 12;
const MAX_HITS = 4;
const MAX_LINE_TEXT = 160;

// Lock files, minified bundles, source maps: match everything, explain nothing.
const LOW_VALUE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock|composer\.lock)$|\.min\.(js|css)$|\.map$|\.svg$/;
// e.g. apiKey, user_id, $store, v2: written like code, kept unstemmed.
const CODE_LIKE = /[a-z][A-Z]|_|\$|\d/;
const WORD = /[A-Za-z_$][A-Za-z0-9_$]*/g;
// e.g. src/pay.ts, Dockerfile.dev
const PATH_LIKE = /[\w./-]+\.[A-Za-z0-9]+/g;

const STOPWORDS = new Set(
  `the and for are was were with this that these those what where when which who whom why how does did doing done can could should would will
  from into onto about over under there their them then than have has had not but all any our your you its get gets got use used uses using
  make makes made work works working code file files function functions method methods class classes project app repo repository
  implement implemented implementation happen happens handle handled handles find show explain tell please want need like just also some
  more most other each every between same such here only very much many way ways thing things part parts look looks see call called calls
  add adds adding new end ends run runs live apply applies pick picked press presses pressed user users own able step steps take takes
  being been is be do it in on of to a an or as at by if so no yes we me my i`.split(/\s+/),
);

type Candidate = { file: string; score: number };

// Terms of a question, most specific first: code-like words as written,
// then plain words, lightly stemmed, longest first.
//   "Where is `apiKey` encrypted?" → ["apiKey", "encrypt"]
export function questionTerms(text: string): string[] {
  const words = text.match(WORD) ?? [];
  const code = words.filter((w) => CODE_LIKE.test(w));
  const plain = words
    .filter((w) => !CODE_LIKE.test(w) && !STOPWORDS.has(w.toLowerCase()))
    .map((w) => stem(w.toLowerCase()))
    .sort((a, b) => b.length - a.length);

  return uniqueTerms([...code, ...plain]);
}

// "keys" → "key", "encrypted" → "encrypt", "retries" → "retry". Crude on
// purpose: terms match as substrings, so a short stem still finds the word.
function stem(word: string): string {
  if (word.endsWith("ies") && word.length > 4) {
    return `${word.slice(0, -3)}y`;
  }

  if (word.endsWith("ing") && word.length > 5) {
    return word.slice(0, -3);
  }

  if (word.endsWith("ed") && word.length > 4) {
    return word.slice(0, -2);
  }

  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
    return word.slice(0, -1);
  }

  return word;
}

// Distinct ignoring case, no stopwords or short words, at most MAX_TERMS.
function uniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const t of terms) {
    const key = t.toLowerCase();
    if (t.length < MIN_TERM_LENGTH || STOPWORDS.has(key) || seen.has(key)) {
      continue;
    }

    seen.add(key);
    kept.push(t);
  }

  return kept.slice(0, MAX_TERMS);
}

// Code related to the question, within `budget` characters; "" when nothing
// matches. Paths the question names come first.
export async function relevantCode(view: RepoView, question: string, budget: number): Promise<string> {
  const files = await trackedFiles(view.project.path).catch(() => []);
  const mentioned = mentionedFiles(question, files);
  const terms = questionTerms(question);
  if (terms.length === 0 && mentioned.length === 0) {
    return "";
  }

  const read = cachedReader(view);
  const ranked = await rankFiles(view, read, terms, files, mentioned);
  return render(read, terms, ranked, budget);
}

// The locate tool: files for terms the model picked, optionally in a glob.
export async function locateCode(view: RepoView, terms: string[], glob: string | null, budget: number): Promise<string> {
  const isMatch = glob ? picomatch(glob, { dot: true }) : () => true;
  const files = (await trackedFiles(view.project.path).catch(() => [])).filter((f) => isMatch(f));
  const kept = uniqueTerms(terms.map((t) => t.trim()));
  if (kept.length === 0) {
    return "Error: give at least one term of three or more characters, e.g. refund.";
  }

  const read = cachedReader(view);
  const ranked = await rankFiles(view, read, kept, files, []);
  return (await render(read, kept, ranked, budget)) || `(no files mention ${kept.join(", ")}). Try other words the code would use.`;
}

// File contents, each read once: ranking and rendering read the same files.
type Reader = (file: string) => Promise<string>;

function cachedReader(view: RepoView): Reader {
  const cache = new Map<string, Promise<string>>();
  return (file) => {
    if (!cache.has(file)) {
      cache.set(file, readRepoFile(view, file).then((c) => c ?? ""));
    }

    return cache.get(file)!;
  };
}

// Tracked files the text names, e.g. "pay.ts" or "src/pay.ts" → src/pay.ts.
function mentionedFiles(text: string, files: string[]): string[] {
  const names = text.match(PATH_LIKE) ?? [];
  return names.flatMap((n) => {
    const hits = files.filter((f) => f === n || f.endsWith(`/${n}`));
    return hits.length <= MAX_MENTIONED ? hits : [];
  });
}

// BM25 over line counts, plus path matches. The best RERANK_FILES are
// re-scored with their length and declarations: a 9,000-line .d.ts naming
// every term once loses to the 200-line file built around them. Best first.
async function rankFiles(view: RepoView, read: Reader, terms: string[], files: string[], mentioned: string[]): Promise<Candidate[]> {
  const sha = view.review?.headSha ?? null;
  const allowed = new Set(files.filter((f) => !LOW_VALUE.test(f)));
  const counts = await Promise.all(terms.map((t) => matchCounts(view.project.path, t, sha).catch(() => new Map<string, number>())));
  const needles = terms.map((t) => t.toLowerCase());

  // Rare terms weigh more: idf from the number of files containing each.
  const total = Math.max(allowed.size, 1);
  const idf = counts.map((c) => {
    const df = [...c.keys()].filter((f) => allowed.has(f)).length;
    return Math.log(1 + (total - df + 0.5) / (df + 0.5));
  });

  // lengthNorm: 1 = average length, above 1 = longer, damping its counts.
  const scoreOf = (file: string, lengthNorm: number) => {
    const lower = file.toLowerCase();
    const score = needles.reduce((sum, n, i) => {
      const tf = counts[i].get(file) ?? 0;
      const content = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * lengthNorm);
      return sum + idf[i] * (content + pathWeight(lower, n));
    }, 0);
    const mention = mentioned.includes(file) ? MENTION_SCORE : 0;
    return (isTestPath(file) ? score * TEST_FACTOR : score) + mention;
  };

  const candidates = new Set([...mentioned, ...counts.flatMap((c) => [...c.keys()]), ...[...allowed].filter((f) => needles.some((n) => f.toLowerCase().includes(n)))]);
  const first = [...candidates].filter((f) => allowed.has(f) || mentioned.includes(f)).map((file) => ({ file, score: scoreOf(file, 1) }));
  first.sort((a, b) => b.score - a.score);

  // A file declaring the concept beats one that only mentions it.
  const importance = await importanceOf(view);
  const rescored = await Promise.all(
    first.slice(0, RERANK_FILES).map(async (c) => {
      const content = await read(c.file);
      const lengthNorm = 1 - BM25_B + (BM25_B * content.split("\n").length) / AVERAGE_FILE_LINES;
      const declarations = outline(content).join("\n").toLowerCase();
      const bonus = needles.reduce((sum, n, i) => (declarations.includes(n) ? sum + idf[i] * DECLARATION_WEIGHT : sum), 0);
      return { file: c.file, score: scoreOf(c.file, lengthNorm) + bonus + IMPORTANCE_WEIGHT * (importance.get(c.file) ?? 0) };
    }),
  );

  return [...rescored.sort((a, b) => b.score - a.score), ...first.slice(RERANK_FILES)];
}

// File → 1 for the most depended-on file, down to 0; empty while the
// symbol index builds.
async function importanceOf(view: RepoView): Promise<Map<string, number>> {
  const ranked = (await rankedFiles(view.project.path).catch(() => null)) ?? [];
  return new Map(ranked.map((r, i) => [r.file, 1 - i / ranked.length]));
}

// "src/terminal/linkDetector.ts", "link" → NAME_WEIGHT; "terminal" → DIRECTORY_WEIGHT.
function pathWeight(file: string, needle: string): number {
  const slash = file.lastIndexOf("/");
  if (file.slice(slash + 1).includes(needle)) {
    return NAME_WEIGHT;
  }

  return file.slice(0, slash + 1).includes(needle) ? DIRECTORY_WEIGHT : 0;
}

// Shown files' blocks while they fit `budget`, then the next files by name:
//   Terms: refund, payment
//   ### src/pay.ts (212 lines)
//   40: export function refund(order: Order) {
//   57:   const payment = order.payments[0];
//   Also matching: src/pay.test.ts, docs/refunds.md
async function render(read: Reader, terms: string[], ranked: Candidate[], budget: number): Promise<string> {
  if (ranked.length === 0) {
    return "";
  }

  const header = `Terms: ${terms.join(", ") || "(paths only)"}`;
  const blocks: string[] = [];
  let used = header.length;
  let next = 0;

  for (; next < ranked.length; next++) {
    const block = await fileBlock(read, ranked[next].file, terms);
    if (used + block.length > budget) {
      break;
    }

    blocks.push(block);
    used += block.length;
  }

  if (blocks.length === 0) {
    return "";
  }

  const rest = ranked.slice(next, next + LISTED_FILES).map((c) => c.file);
  const more = rest.length > 0 ? `\nAlso matching: ${rest.join(", ")}` : "";
  return [header, ...blocks].join("\n\n") + more;
}

// A file's declarations and matching lines, in line order. Declarations
// naming a term come first when the file has too many to show.
async function fileBlock(read: Reader, file: string, terms: string[]): Promise<string> {
  const content = await read(file);
  const lines = content.split(/\r?\n/);
  const needles = terms.map((t) => t.toLowerCase());
  const hitsIn = (text: string) => needles.filter((n) => text.toLowerCase().includes(n)).length;

  const declarations = outline(content).map((d) => ({ line: Number(d.slice(0, d.indexOf(":"))), hits: hitsIn(d) }));
  const shownDeclarations = [...declarations].sort((a, b) => b.hits - a.hits).slice(0, MAX_DECLARATIONS);
  const declared = new Set(declarations.map((d) => d.line));

  // Non-declaration lines naming the most terms, e.g. a call or a config key.
  const hits = lines
    .map((text, i) => ({ line: i + 1, hits: declared.has(i + 1) ? 0 : hitsIn(text) }))
    .filter((h) => h.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, MAX_HITS);

  const shown = [...new Set([...shownDeclarations, ...hits].map((h) => h.line))].sort((a, b) => a - b);
  const body = shown.map((n) => `${n}: ${lines[n - 1].trim().slice(0, MAX_LINE_TEXT)}`).join("\n");
  const cut = declarations.length > MAX_DECLARATIONS ? `\n… ${declarations.length - MAX_DECLARATIONS} more declarations (outline shows all)` : "";
  return `### ${file} (${lines.length} lines)\n${body}${cut}`;
}
