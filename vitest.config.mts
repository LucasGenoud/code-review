import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve("src") } },
  // .next/standalone and the npm package (dist) hold copies of the sources after a build.
  test: { exclude: [...configDefaults.exclude, ".next/**", "dist/**"] },
});
