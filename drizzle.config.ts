import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/drivers/schema.ts",
  out: "./drizzle",
});
