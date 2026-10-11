// Finds LLM-quoted code in a file. LLMs get line numbers wrong, so the quote
// is the anchor and the reported line only breaks ties between matches.
//
//   1. exact text match (line endings normalized)
//   2. else line-by-line match ignoring indentation and trailing spaces

export type Span = { start: number; end: number }; // 1-based, inclusive

const CRLF = /\r\n/g;

export function locate(content: string, quote: string, hintLine: number): Span | null {
  const matches = exactMatches(content, quote);
  const found = matches.length > 0 ? matches : looseMatches(content, quote);
  return closest(found, hintLine);
}

// Replaces the quoted code with `replacement`, keeping the file's line
// endings. Null when the quote isn't found exactly once.
export function replaceQuote(content: string, quote: string, replacement: string): string | null {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const text = content.replace(CRLF, "\n");
  const q = trimNewlines(quote.replace(CRLF, "\n"));
  const r = trimNewlines(replacement.replace(CRLF, "\n"));

  const exact = exactMatches(content, quote);
  if (exact.length > 1) {
    return null;
  }

  if (exact.length === 1) {
    return restoreEol(replaceExact(text, q, r), eol);
  }

  // Indentation differs: swap the whole matched lines.
  const loose = looseMatches(content, quote);
  if (loose.length !== 1) {
    return null;
  }

  const lines = text.split("\n");
  const { start, end } = loose[0];
  const fixed = reindent(r, indentOf(q), indentOf(lines[start - 1]));
  lines.splice(start - 1, end - start + 1, ...fixed.split("\n"));
  return restoreEol(lines.join("\n"), eol);
}

// A quote covering whole lines (only whitespace around it) is replaced as
// lines and re-indented; a fragment inside a line is replaced in place.
// e.g. quote "return t" in "    return t" → whole line, keeps "    "
//      quote "foo(a)" in "x = foo(a)"   → fragment
function replaceExact(text: string, q: string, r: string): string {
  const at = text.indexOf(q);
  const end = at + q.length;
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const nextNewline = text.indexOf("\n", end);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;

  const before = text.slice(lineStart, at);
  const after = text.slice(end, lineEnd);
  if (before.trim() || after.trim()) {
    return text.slice(0, at) + r + text.slice(end);
  }

  const fixed = reindent(r, indentOf(q), before + indentOf(q));
  return text.slice(0, lineStart) + fixed + text.slice(lineEnd);
}

// Moves replacement lines from the quote's indentation to the file's.
function reindent(text: string, from: string, to: string): string {
  if (from === to) {
    return text;
  }

  return text
    .split("\n")
    .map((line) => {
      if (!line.trim()) {
        return line;
      }

      return line.startsWith(from) ? to + line.slice(from.length) : line;
    })
    .join("\n");
}

function indentOf(text: string): string {
  return /^[ \t]*/.exec(text)?.[0] ?? "";
}

function exactMatches(content: string, quote: string): Span[] {
  const text = content.replace(CRLF, "\n");
  const q = trimNewlines(quote.replace(CRLF, "\n"));
  if (!q.trim()) {
    return [];
  }

  const spans: Span[] = [];
  const quoteLines = q.split("\n").length;

  for (let at = text.indexOf(q); at !== -1; at = text.indexOf(q, at + 1)) {
    const start = text.slice(0, at).split("\n").length;
    spans.push({ start, end: start + quoteLines - 1 });
  }

  return spans;
}

function looseMatches(content: string, quote: string): Span[] {
  const lines = content.replace(CRLF, "\n").split("\n").map((l) => l.trim());
  const wanted = quote.replace(CRLF, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (wanted.length === 0) {
    return [];
  }

  const spans: Span[] = [];
  for (let i = 0; i + wanted.length <= lines.length; i++) {
    if (wanted.every((w, k) => lines[i + k] === w)) {
      spans.push({ start: i + 1, end: i + wanted.length });
    }
  }

  return spans;
}

function closest(spans: Span[], hint: number): Span | null {
  if (spans.length === 0) {
    return null;
  }

  return spans.reduce((best, s) =>
    Math.abs(s.start - hint) < Math.abs(best.start - hint) ? s : best,
  );
}

function trimNewlines(s: string): string {
  return s.replace(/^\n+|\n+$/g, "");
}

function restoreEol(text: string, eol: string): string {
  return eol === "\n" ? text : text.replace(/\n/g, eol);
}
