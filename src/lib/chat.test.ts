import { expect, it } from "vitest";
import { citedFiles, splitFollowUps } from "./chat";

it("splits off the follow-ups line", () => {
  const answer = "Keys are sealed in src/crypto.ts:12.\n\nFollow-ups: Who rotates them? | `Where is the secret?`";

  expect(splitFollowUps(answer)).toEqual({ body: "Keys are sealed in src/crypto.ts:12.", followUps: ["Who rotates them?", "Where is the secret?"] });
  expect(splitFollowUps("Plain answer.")).toEqual({ body: "Plain answer.", followUps: [] });
});

it("holds back a follow-ups line still streaming in", () => {
  expect(splitFollowUps("Answer.\nFollow-u")).toEqual({ body: "Answer.", followUps: [] });
  expect(splitFollowUps("Answer.\nFollowing the call…")).toEqual({ body: "Answer.\nFollowing the call…", followUps: [] });
});

it("lists cited files once, at their first line", () => {
  const text = "See `src/pay.ts:42-50`, then src/pay.ts:90 and (lib/db.py:7). Not localhost:3000.";

  expect(citedFiles(text)).toEqual([
    { path: "src/pay.ts", line: 42 },
    { path: "lib/db.py", line: 7 },
  ]);
});
