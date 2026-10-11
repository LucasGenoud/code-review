<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project

Single-user web app that reviews git diffs of local projects against configurable rules, using any LLM API.

Stack: Next.js (App Router) · shadcn/ui + Tailwind · Drizzle + better-sqlite3 · Vercel AI SDK · `git` CLI · Docker.

## Architecture

Each layer calls only the layer directly below it.

```
 UI          src/app (pages), src/components
   │  server actions, fetch
 API         src/app/**/actions.ts, src/app/api/**/route.ts
   │
 Services    src/server/services   (domain logic: projects, rules, reviews)
   │
 Drivers     src/server/drivers    (db, git, fs, llm — raw I/O only)
```

- UI never imports from `src/server`.
- Actions never touch the DB or spawn processes; they call services.
- Drivers expose domain-level APIs (`repoRoot(dir)`), not raw mechanics.

## Writing style

Applies to comments, commit messages and replies.

- Use as few words as possible. Pick every word carefully. Be to the point.
- No superlatives, no praise. State facts.

## Code rules

- No magic numbers or strings: extract recurring or meaningful values into named constants or enums. Keep self-explanatory one-off values inline. Spec values (e.g. HTTP 200) always get a constant.
- Reduce indentation. Avoid the arrow anti-pattern: use early `return` and `continue`.
- Function names under 30 characters.
- Use enums instead of booleans for function parameters.
- Separate logical blocks with empty lines.
- Comment each block with a short *what* and *why*. Use examples when possible. Use ASCII drawings for complete systems.
- Always use `{}`, even for one-line `if`.
- Keep fields and functions private (not exported) unless the design requires external access. Changing visibility is a breaking design change: ask the user for explicit approval first.
- Program to levels of abstraction. Low-level mechanics (process spawning, sockets, file I/O, SQL) live in a driver layer behind clean high-level APIs.
- Respect the layer hierarchy above. Never call through layers.
- Don't touch code unrelated to the feature. Don't add comments to code you didn't write or change. Minimize changed lines.

## Bug fixes

Write the test first. See it fail. Write the fix. See it pass.

## Commit messages

1. Blank line between subject and body.
2. Subject ≤ 50 characters (72 hard limit).
3. Capitalize the subject.
4. No period at the end of the subject.
5. Imperative mood: "If applied, this commit will <subject>".
6. Wrap the body at 72 characters.
7. Body explains what and why, not how.
