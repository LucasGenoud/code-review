import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve("src") } },
  // .next/standalone holds a copy of the sources after a build.
  test: { exclude: [...configDefaults.exclude, ".next/**"] },
});
