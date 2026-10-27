import type { UIMessage } from "ai";
import { projectChatResponse } from "@/server/services/chat";
import { InputError } from "@/server/services/errors";

const HTTP_BAD_REQUEST = 400;

// useChat endpoint: streams the answer to a question about the codebase,
// in conversation `threadId`.
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/chat">) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { messages?: UIMessage[]; threadId?: number };
  if (!Array.isArray(body.messages) || typeof body.threadId !== "number") {
    return Response.json({ error: "messages and threadId required" }, { status: HTTP_BAD_REQUEST });
  }

  try {
    return await projectChatResponse(Number(id), body.threadId, body.messages);
  } catch (e) {
    if (e instanceof InputError) {
      return Response.json({ error: e.message }, { status: HTTP_BAD_REQUEST });
    }

    throw e;
  }
}
