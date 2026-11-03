import { InputError } from "@/server/services/errors";
import { reviewProgress } from "@/server/services/reviews";

const HTTP_NOT_FOUND = 404;

// Polled by the report while a review runs: unit states and a version
// telling when the full report changed. A route, not a server action, so
// polls don't queue behind the user's finding actions.
export async function GET(_req: Request, ctx: RouteContext<"/api/reviews/[id]/progress">) {
  const { id } = await ctx.params;

  try {
    return Response.json(reviewProgress(Number(id)));
  } catch (e) {
    if (e instanceof InputError) {
      return Response.json({ error: e.message }, { status: HTTP_NOT_FOUND });
    }

    throw e;
  }
}
