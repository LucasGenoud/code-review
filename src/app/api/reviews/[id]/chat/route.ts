import type { UIMessage } from "ai";
import { chatResponse, resumeReviewChat, stopReviewChat } from "@/server/services/chat";
import { InputError } from "@/server/services/errors";

const HTTP_BAD_REQUEST = 400;
const HTTP_NO_CONTENT = 204;

// useChat endpoint: streams the assistant's answer about a review.
export async function POST(req: Request, ctx: RouteContext<"/api/reviews/[id]/chat">) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { messages?: UIMessage[] };
  if (!Array.isArray(body.messages)) {
    return Response.json({ error: "messages required" }, { status: HTTP_BAD_REQUEST });
  }

  try {
    return await chatResponse(Number(id), body.messages);
  } catch (e) {
    if (e instanceof InputError) {
      return Response.json({ error: e.message }, { status: HTTP_BAD_REQUEST });
    }

    throw e;
  }
}

// useChat reconnect after a reload: the answer still being generated.
export async function GET(_req: Request, ctx: RouteContext<"/api/reviews/[id]/chat">) {
  const { id } = await ctx.params;
  return resumeReviewChat(Number(id)) ?? new Response(null, { status: HTTP_NO_CONTENT });
}

// Stop button: ends the generation on the server, not just the download.
export async function DELETE(_req: Request, ctx: RouteContext<"/api/reviews/[id]/chat">) {
  const { id } = await ctx.params;
  stopReviewChat(Number(id));
  return new Response(null, { status: HTTP_NO_CONTENT });
}
