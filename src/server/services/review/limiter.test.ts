import { expect, it } from "vitest";
import { limiter, modelLimiter } from "./limiter";

it("never runs more than max tasks at once", async () => {
  const run = limiter(2);
  let active = 0;
  let peak = 0;

  const task = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  };

  await Promise.all(Array.from({ length: 6 }, () => run(task)));
  expect(peak).toBe(2);
});

it("caps a model across reviews, not per review", async () => {
  let active = 0;
  let peak = 0;
  const task = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  };

  // Two reviews on model 1, each asking for its own limiter.
  const reviewA = modelLimiter(1, 2);
  const reviewB = modelLimiter(1, 2);
  await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? reviewA : reviewB)(task)));
  expect(peak).toBe(2);

  // A changed setting takes effect for the next review.
  expect(modelLimiter(1, 3)).not.toBe(reviewA);
});
