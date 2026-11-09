import { threadMarkdown } from "@/server/services/chat";
import { InputError } from "@/server/services/errors";

const HTTP_NOT_FOUND = 404;

// Downloads a codebase conversation as Markdown.
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/threads/[threadId]/export">) {
  const { id, threadId } = await ctx.params;

  try {
    const { filename, markdown } = threadMarkdown(Number(id), Number(threadId));
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
