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
