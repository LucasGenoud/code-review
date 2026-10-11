import { InputError } from "@/server/services/errors";
import { exportMarkdown } from "@/server/services/reviews";

const HTTP_NOT_FOUND = 404;

// Downloads the review report as Markdown.
export async function GET(_req: Request, ctx: RouteContext<"/api/reviews/[id]/export">) {
  const { id } = await ctx.params;

  try {
    const { filename, markdown } = exportMarkdown(Number(id));
    return new Response(markdown, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    if (e instanceof InputError) {
      return new Response(e.message, { status: HTTP_NOT_FOUND });
    }

    throw e;
  }
}
