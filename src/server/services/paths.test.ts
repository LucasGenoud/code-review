import path from "node:path";
import { describe, expect, it } from "vitest";
import { isInside, isTestPath } from "./paths";

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

describe("isTestPath", () => {
  it("knows test layouts across languages", () => {
    const tests = ["src/test/java/shop/Cart.java", "a/__tests__/x.js", "pay.test.ts", "pay_test.go", "shop/PayServiceTest.java", "shop/PayIT.java", "x/testdata/a.json"];
    const code = ["src/main/java/shop/Contest.java", "src/latest.ts", "src/attestation.ts"];

    expect(tests.filter(isTestPath)).toEqual(tests);
    expect(code.filter(isTestPath)).toEqual([]);
  });
});
