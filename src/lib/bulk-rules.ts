const LIST_MARKER = /^\s*(?:[-*•]|\d+[.)]|\[[ xX]?\])\s+/;
const FIELD_SEPARATOR = "|";

// Split pasted pairs once so descriptions can contain pipes.
export function parseBulkRules(text: string) {
  const rules: { name: string; description: string }[] = [];
  const errors: string[] = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(LIST_MARKER, "").trim();
    if (!line) {
      return;
    }

    const separator = line.indexOf(FIELD_SEPARATOR);
    const name = separator < 0 ? "" : line.slice(0, separator).trim();
    const description = separator < 0 ? "" : line.slice(separator + FIELD_SEPARATOR.length).trim();
    if (!name || !description) {
      errors.push(`Line ${index + 1}: use Name | Description.`);
      return;
    }

    rules.push({ name, description });
  });

  return { rules, errors };
}
