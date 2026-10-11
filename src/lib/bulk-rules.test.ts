import { describe, expect, it } from "vitest";
import { parseBulkRules } from "./bulk-rules";

describe("bulk rule paste", () => {
  it("handles bullets, blank lines and pipes in descriptions", () => {
    expect(parseBulkRules("- Constants | Use named values.\r\n\r\n2) Types | Prefer A | B.")).toEqual({
      rules: [
        { name: "Constants", description: "Use named values." },
        { name: "Types", description: "Prefer A | B." },
      ],
      errors: [],
    });
  });

  it("identifies incomplete rows without inventing names", () => {
    expect(parseBulkRules("Valid | Description\nMissing pair\n | No name\nNo description | ").errors).toEqual([
      "Line 2: use Name | Description.",
      "Line 3: use Name | Description.",
      "Line 4: use Name | Description.",
    ]);
  });
});
