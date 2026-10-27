import type { UIMessage } from "ai";
import { projectChatResponse, resumeProjectChat, stopProjectChat } from "@/server/services/chat";
import { InputError } from "@/server/services/errors";

const HTTP_BAD_REQUEST = 400;
const HTTP_NO_CONTENT = 204;

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

// useChat reconnect after a reload: ?threadId=3's answer still being generated.
export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/chat">) {
  return withThread(req, ctx, (projectId, threadId) => resumeProjectChat(projectId, threadId) ?? new Response(null, { status: HTTP_NO_CONTENT }));
}

// Stop button: ends ?threadId=3's generation on the server.
export async function DELETE(req: Request, ctx: RouteContext<"/api/projects/[id]/chat">) {
  return withThread(req, ctx, (projectId, threadId) => {
    stopProjectChat(projectId, threadId);
    return new Response(null, { status: HTTP_NO_CONTENT });
  });
}

type ThreadHandler = (projectId: number, threadId: number) => Response;

async function withThread(req: Request, ctx: RouteContext<"/api/projects/[id]/chat">, handle: ThreadHandler) {
  const { id } = await ctx.params;
  const threadId = Number(new URL(req.url).searchParams.get("threadId"));
  if (!Number.isInteger(threadId)) {
    return Response.json({ error: "threadId required" }, { status: HTTP_BAD_REQUEST });
  }

  try {
    return handle(Number(id), threadId);
  } catch (e) {
    if (e instanceof InputError) {
      return Response.json({ error: e.message }, { status: HTTP_BAD_REQUEST });
    }

    throw e;
  }
}
