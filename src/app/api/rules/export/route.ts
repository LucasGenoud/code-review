import { connection } from "next/server";
import { exportRules } from "@/server/services/rules";

const FILENAME = "pr-review-rules.json";
const JSON_INDENT = 2;

// Downloads the global rules as JSON, for import elsewhere.
export async function GET() {
  // Request time, never prerendered: rules change.
  await connection();
  return new Response(JSON.stringify(exportRules(), null, JSON_INDENT), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${FILENAME}"`,
    },
  });
}
