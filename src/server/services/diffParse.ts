import { FileChange } from "@/lib/domain";

// Parses `git diff` output into files and hunks.
//
//   diff --git a/x b/x        ← file starts
//   --- a/x / +++ b/x          ← paths (/dev/null = added or deleted)
//   @@ -10,7 +10,8 @@ ctx     ← hunk: old start,len  new start,len
//   " ctx" "+add" "-del"       ← lines

export enum LineKind {
  Context = "context",
  Add = "add",
  Del = "del",
}

export type DiffLine = { kind: LineKind; text: string; oldNo: number | null; newNo: number | null };

export type Hunk = {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
};

export type ParsedFile = {
  path: string;
  oldPath: string | null;
  change: FileChange;
  binary: boolean;
  hunks: Hunk[];
  // Raw text of this file's diff, for the viewer and change detection.
  patch: string;
};

const FILE_START = "diff --git ";
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const NULL_PATH = "/dev/null";
const OLD_PREFIX = "--- ";
const NEW_PREFIX = "+++ ";
const SIDE_PREFIX = /^[ab]\//;
const NO_NEWLINE = "\\";

export function parseDiff(text: string): ParsedFile[] {
  const blocks = text.split(/^(?=diff --git )/m).filter((b) => b.startsWith(FILE_START));
  return blocks.map(parseFile);
}

function parseFile(block: string): ParsedFile {
  const lines = block.replace(/\n$/, "").split("\n");
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let change = FileChange.Modified;
  let binary = false;
  const hunks: Hunk[] = [];

  let i = 1;

  // Header: everything before the first hunk.
  for (; i < lines.length && !lines[i].startsWith("@@"); i++) {
    const line = lines[i];

    if (line.startsWith("new file mode")) {
      change = FileChange.Added;
      continue;
    }

    if (line.startsWith("deleted file mode")) {
      change = FileChange.Deleted;
      continue;
    }

    if (line.startsWith("rename from ")) {
      change = FileChange.Renamed;
      oldPath = line.slice("rename from ".length);
      continue;
    }

    if (line.startsWith("rename to ")) {
      newPath = line.slice("rename to ".length);
      continue;
    }

    if (line.startsWith(OLD_PREFIX)) {
      oldPath = stripSide(line.slice(OLD_PREFIX.length));
      continue;
    }

    if (line.startsWith(NEW_PREFIX)) {
      newPath = stripSide(line.slice(NEW_PREFIX.length));
      continue;
    }

    if (line.startsWith("Binary files")) {
      binary = true;
    }
  }

  // Hunks.
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (; i < lines.length; i++) {
    const line = lines[i];
    const header = HUNK_HEADER.exec(line);

    if (header) {
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      hunk = { header: line, oldStart: oldNo, newStart: newNo, lines: [] };
      hunks.push(hunk);
      continue;
    }

    if (!hunk || line.startsWith(NO_NEWLINE)) {
      continue;
    }

    const text = line.slice(1);
    if (line.startsWith("+")) {
      hunk.lines.push({ kind: LineKind.Add, text, oldNo: null, newNo: newNo++ });
      continue;
    }

    if (line.startsWith("-")) {
      hunk.lines.push({ kind: LineKind.Del, text, oldNo: oldNo++, newNo: null });
      continue;
    }

    hunk.lines.push({ kind: LineKind.Context, text, oldNo: oldNo++, newNo: newNo++ });
  }

  const fallback = pathsFromGitLine(lines[0]);
  const path = (newPath === NULL_PATH ? oldPath : newPath) ?? fallback.newPath;
  const old = oldPath === NULL_PATH ? null : oldPath;

  return {
    path,
    oldPath: change === FileChange.Renamed ? old : null,
    change,
    binary,
    hunks,
    patch: block.endsWith("\n") ? block : `${block}\n`,
  };
}

function stripSide(p: string): string {
  // Git terminates unquoted paths containing spaces with a tab.
  const file = p.replace(/\t$/, "");
  return file === NULL_PATH ? file : file.replace(SIDE_PREFIX, "");
}

// "diff --git a/x b/x" → paths. Ambiguous with spaces; last resort only.
function pathsFromGitLine(line: string): { newPath: string } {
  const rest = line.slice(FILE_START.length);
  const split = rest.indexOf(" b/");
  return { newPath: split === -1 ? rest : rest.slice(split + " b/".length) };
}

// Diff of a new untracked file: every line added.
export function addedFilePatch(path: string, content: string): ParsedFile {
  const body = content.replace(/\r?\n$/, "");
  const textLines = body === "" ? [] : body.split(/\r?\n/);
  const header = `@@ -0,0 +1,${textLines.length} @@`;

  const patch = [
    `${FILE_START}a/${path} b/${path}`,
    "new file mode 100644",
    `${OLD_PREFIX}${NULL_PATH}`,
    `${NEW_PREFIX}b/${path}`,
    ...(textLines.length ? [header, ...textLines.map((l) => `+${l}`)] : []),
  ].join("\n");

  return {
    path,
    oldPath: null,
    change: FileChange.Added,
    binary: false,
    hunks: textLines.length
      ? [{
        header,
        oldStart: 0,
        newStart: 1,
        lines: textLines.map((text, i) => ({ kind: LineKind.Add, text, oldNo: null, newNo: i + 1 })),
      }]
      : [],
    patch: `${patch}\n`,
  };
}

// Hunks as prompt text, new-file line numbers on the left.
// e.g.
//   @@ -10,2 +10,3 @@
//     10   unchanged
//     11 + added
//        - removed
export function formatHunks(hunks: Hunk[]): string {
  const NUMBER_WIDTH = 5;
  const blank = " ".repeat(NUMBER_WIDTH);
  const marks: Record<LineKind, string> = {
    [LineKind.Context]: " ",
    [LineKind.Add]: "+",
    [LineKind.Del]: "-",
  };

  return hunks
    .map((h) => {
      const body = h.lines.map((l) => {
        const no = l.newNo === null ? blank : String(l.newNo).padStart(NUMBER_WIDTH);
        return `${no} ${marks[l.kind]} ${l.text}`;
      });
      return [h.header, ...body].join("\n");
    })
    .join("\n");
}
