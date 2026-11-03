// Language-agnostic symbol lookup by pattern, for the chat's find_definition
// and outline tools. Covers TS/JS, Python, Java/C#/Kotlin, Go and Rust
// declaration shapes; regex, not a parser: a few false hits are fine, the
// model reads the lines it gets.

// Characters of an identifier, e.g. savePayment, $el, user_id.
const IDENT = "A-Za-z0-9_$";
const KEYWORDS = "function|class|interface|type|enum|struct|trait|def|fn|func|record|module|mod|object|const|let|var|val|impl";
const MODIFIERS = "public|private|protected|internal|static|async|override|abstract|final|export|default|readonly|get|set|pub|virtual|sealed";
const MAX_OUTLINE_TEXT = 160;

// Outline lines (JS regex): declarations and class members.
//   "export async function load(" · "class Cart {" · "def total(self):" · "  save(order: Order) {"
const DECLARATION = new RegExp(
  `^\\s*((${MODIFIERS})(\\([^)]*\\))?\\s+)*(${KEYWORDS.replace("|const|let|var|val", "")})\\s+[${IDENT}(]`,
);
const ARROW = new RegExp(`^\\s*(export\\s+)?(const|let|var)\\s+[${IDENT}]+\\s*(:[^=]+)?=\\s*(async\\s*)?(\\(|function\\b|[${IDENT}]+\\s*=>)`);
const MEMBER = new RegExp(`^\\s+((${MODIFIERS})\\s+)*[${IDENT}]+\\s*(<[^>]*>)?\\([^;]*\\)\\s*(:\\s*[^={;]+)?\\{\\s*$`);
const CONTROL = /^\s*(if|for|while|switch|catch|return|else)\b/;

// Extended regex (git grep -E) for lines declaring `name`. POSIX ERE has
// no \b, so word edges are spelled out.
//   function name( · class name · def name( · name = (…) => · name: function · public void name(…) {
export function definitionPattern(name: string): string {
  const n = name.replace(/[$]/g, "\\$");
  const before = `(^|[^${IDENT}.])`;
  const after = `([^${IDENT}]|$)`;

  const keyword = `${before}(${KEYWORDS})[[:space:]]+(\\([^)]*\\)[[:space:]]*)?${n}${after}`;
  const assigned = `${before}${n}[[:space:]]*[:=][[:space:]]*(async[[:space:]]+)?(function|\\(|[${IDENT}]+[[:space:]]*=>)`;
  const method = `^[[:space:]]*((${MODIFIERS})[[:space:]]+)*([${IDENT}<>,.?]+[[:space:]]+)?${n}[[:space:]]*(<[^>]*>)?\\(([^;]*\\{[[:space:]]*|[^)]*)$`;
  return [keyword, assigned, method].join("|");
}

// "12: export function load(id: number) {" for each declaration in `source`.
export function outline(source: string): string[] {
  return source.split(/\r?\n/).flatMap((line, i) => {
    if (!isDeclaration(line)) {
      return [];
    }

    return [`${i + 1}: ${line.trim().slice(0, MAX_OUTLINE_TEXT)}`];
  });
}

function isDeclaration(line: string): boolean {
  if (CONTROL.test(line)) {
    return false;
  }

  return DECLARATION.test(line) || ARROW.test(line) || MEMBER.test(line);
}

// Last line (1-based) of the declaration on `line`, so a tool can return a
// whole function without reading the file. Ends at the closing bracket at
// the declaration's indentation, before the next sibling declaration or
// decorator, or before code indented less (Python). At most `max` lines.
//   "  save() {" … "  }"  → the "}" line
//   "def a():" … "def b():" → the line before "def b():"
export function declarationEnd(source: string, line: number, max: number): number {
  const lines = source.split(/\r?\n/);
  const first = lines[line - 1] ?? "";
  if (/;\s*$/.test(first)) {
    return line;
  }

  const base = indentOf(first);
  const last = Math.min(lines.length, line - 1 + max);
  // Last non-blank line so far: blank lines between declarations aren't theirs.
  let code = line;
  for (let i = line; i < last; i++) {
    const text = lines[i];
    if (!text.trim()) {
      continue;
    }

    if (indentOf(text) < base) {
      return code;
    }

    if (indentOf(text) === base && /^\s*[}\])]/.test(text)) {
      return i + 1;
    }

    if (indentOf(text) === base && (isDeclaration(text) || /^\s*@/.test(text))) {
      return code;
    }

    code = i + 1;
  }

  return code;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}
