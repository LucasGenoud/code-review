import { describe, expect, it } from "vitest";
import { locate, replaceQuote } from "./locate";

const FILE = [
  "def total(items):",
  "    t = 0",
  "    for i in items:",
  "        t = t + i",
  "    return t",
  "",
  "def other():",
  "    t = 0",
].join("\n");

describe("locate", () => {
  it("finds an exact multi-line quote", () => {
    expect(locate(FILE, "    for i in items:\n        t = t + i", 1)).toEqual({ start: 3, end: 4 });
  });

  it("uses the hint to pick between repeated matches", () => {
    expect(locate(FILE, "    t = 0", 7)).toEqual({ start: 8, end: 8 });
    expect(locate(FILE, "    t = 0", 1)).toEqual({ start: 2, end: 2 });
  });

  it("falls back to indentation-insensitive matching", () => {
    expect(locate(FILE, "for i in items:\nt = t + i", 1)).toEqual({ start: 3, end: 4 });
  });

  it("handles CRLF files and returns null when absent", () => {
    expect(locate(FILE.replace(/\n/g, "\r\n"), "return t", 1)).toEqual({ start: 5, end: 5 });
    expect(locate(FILE, "nope", 1)).toBeNull();
    expect(locate(FILE, "   ", 1)).toBeNull();
  });
});

describe("replaceQuote", () => {
  it("replaces a unique exact quote", () => {
    const out = replaceQuote(FILE, "        t = t + i", "        t += i");
    expect(out?.split("\n")[3]).toBe("        t += i");
  });

  it("keeps CRLF line endings", () => {
    const out = replaceQuote(FILE.replace(/\n/g, "\r\n"), "    return t", "    return int(t)\n");
    expect(out).toContain("    return int(t)\r\n");
    expect(out).not.toMatch(/[^\r]\n/);
  });

  it("refuses ambiguous quotes", () => {
    expect(replaceQuote(FILE, "    t = 0", "    t = 1")).toBeNull();
  });

  it("re-indents when the quote lacks the file's indentation", () => {
    expect(replaceQuote(FILE, "return t", "return t * 2")?.split("\n")[4]).toBe("    return t * 2");

    const loose = replaceQuote(FILE, "for i in items:\nt = t + i", "for i in items:\n    t += i");
    expect(loose?.split("\n").slice(2, 4)).toEqual(["    for i in items:", "        t += i"]);
  });

  it("replaces a fragment inside a line in place", () => {
    expect(replaceQuote(FILE, "t + i", "t + 2 * i")?.split("\n")[3]).toBe("        t = t + 2 * i");
  });
});
