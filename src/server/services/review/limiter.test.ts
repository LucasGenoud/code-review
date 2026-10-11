import { expect, it } from "vitest";
import { limiter } from "./limiter";

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
