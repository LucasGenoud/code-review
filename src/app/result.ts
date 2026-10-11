import { InputError } from "@/server/services/errors";

// Outcome of a mutation action. `error` is safe to show to the user.
export type Result<T = void> = { data: T; error?: never } | { data?: never; error: string };

// Turns InputError into a displayable result. Other errors propagate:
// Next.js redacts their messages in production.
export async function attempt<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { data: await fn() };
  } catch (e) {
    if (e instanceof InputError) {
      return { error: e.message };
    }

    if (e instanceof Error && e.name === "ZodError") {
      return { error: "Invalid input" };
    }

    throw e;
  }
}
