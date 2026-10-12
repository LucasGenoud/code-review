// Runs at most `max` tasks at once. e.g. limit(2): 3rd task waits for a slot.
// A finishing task hands its slot straight to the next waiter, so a new
// caller can't slip in between.
export function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active++;
    }

    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) {
        next();
      } else {
        active--;
      }
    }
  };
}

type Limit = ReturnType<typeof limiter>;

const byModel = new Map<number, { max: number; run: Limit }>();

// One limiter per model, shared by every running review, so the model's
// max concurrency caps its requests, not each review's. A changed max
// starts a fresh limiter; tasks already queued on the old one finish there.
export function modelLimiter(modelId: number, max: number): Limit {
  const current = byModel.get(modelId);
  if (current && current.max === max) {
    return current.run;
  }

  const run = limiter(max);
  byModel.set(modelId, { max, run });
  return run;
}
