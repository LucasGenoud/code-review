import path from "node:path";
import { describe, expect, it } from "vitest";
import { isInside } from "./paths";

const root = path.resolve("/repos");

describe("isInside", () => {
  it("accepts the root and its children", () => {
    expect(isInside(root, root)).toBe(true);
    expect(isInside(root, path.join(root, "app", "src"))).toBe(true);
    expect(isInside(root, path.join(root, "..app"))).toBe(true);
  });

  it("rejects parents, siblings and traversal", () => {
    expect(isInside(root, path.resolve("/"))).toBe(false);
    expect(isInside(root, path.resolve("/repos-other"))).toBe(false);
    expect(isInside(root, path.join(root, "..", "etc"))).toBe(false);
  });
});
