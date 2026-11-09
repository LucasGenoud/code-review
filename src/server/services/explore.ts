import { z } from "zod";
import { defineTool, generateAgentText, type ChatTool, type Usage } from "@/server/drivers/llm";
import type { ResolvedModel } from "./providers";
import { repoMap, repoTools, semanticTools, ToolScope, type RepoView } from "./repoTools";

// Explorer sub-agents for broad questions. The chat model calls explore
// several times in one step, one area each; they run in parallel, each in
// its own context with the read-only repository tools, and return a short
// report. The conversation only grows by the reports, not by every file
// the explorers read.
//
//   "how does auth work?" ─► chat model ─┬─ explore(login flow)      ─► report ─┐
//                                        ├─ explore(session expiry)  ─► report ─┼─► answer
//                                        └─ explore(token storage)   ─► report ─┘

// Tool rounds per explorer; its context share of the window before it
// must report.
const EXPLORER_STEPS = 10;
const EXPLORER_CONTEXT_SHARE = 0.6;
const MAP_CHARS = 4_000;
const MAX_REPORT_CHARS = 6_000;

const EXPLORER = (project: string, steps: number) => `You are an explorer working for a senior engineer who is answering a developer's question about the project "${project}". You investigate one assignment in the code and report back to the engineer; you never talk to the developer, and your report is all the engineer sees of your work. You read code through read-only tools; you can't modify anything.

## Method
- Start from the repository map below. To find where a concept lives, call locate once with the identifiers and words the code would use, synonyms included; use semantic_search when it is available and the concept has no obvious name.
- Batch: call independent reads and searches in the same step, e.g. read_symbol with several names. Prefer read_symbol and line ranges over whole files.
- Trace the real path through the code (entry point → calls → result) instead of inferring from names.
- Stay inside your assignment. Something important outside it gets one line in the report, not an investigation.
- You have about ${steps} tool rounds. Stop as soon as you can report with evidence.

## Report
- At most 300 words, in plain markdown. Lead with the direct answer to the assignment in one or two sentences.
- Back every claim with path:line (e.g. src/pay.ts:42). Name the functions, classes and files the engineer should read.
- End with what you could not settle, if anything. No preamble, no restating the assignment, no advice to the developer.`;

// The explore tool: runs one explorer per call with the turn's model.
// `spent` accumulates the explorers' tokens for the turn.
export function exploreTools(view: RepoView, model: ResolvedModel, spent: Usage): Record<string, ChatTool> {
  return {
    explore: defineTool({
      description:
        "Delegate an investigation to an explorer sub-agent with its own context and the read-only repository tools; it returns a short report with path:line citations. For broad questions spanning several areas (a tour, an audit, a flow across layers), call it several times in the same step, one area each: they run in parallel. Give each a self-contained assignment. Don't use it for a lookup you can do in one or two calls.",
      input: z.object({
        assignment: z.string().min(10).describe("What to find out, self-contained, e.g. How are expired sessions detected and cleared?"),
        focus: z.string().nullable().describe("Where to start, if known, e.g. src/server/auth/**"),
      }),
      run: async ({ assignment, focus }, signal) => {
        const map = await repoMap(view, MAP_CHARS);
        const tools = { ...repoTools(view, ToolScope.Chat), ...semanticTools(view) };
        const { text, usage } = await generateAgentText(model.config, {
          instructions: `${EXPLORER(view.project.name, EXPLORER_STEPS)}\n\n## Repository map\n${map}`,
          prompt: focus ? `${assignment}\n\nStart from: ${focus}` : assignment,
          tools,
          budget: { steps: EXPLORER_STEPS, contextTokens: Math.floor(model.model.contextWindow * EXPLORER_CONTEXT_SHARE) },
          signal,
        });

        spent.input += usage.input;
        spent.output += usage.output;
        return text.trim().slice(0, MAX_REPORT_CHARS) || "(the explorer found nothing to report)";
      },
    }),
  };
}
