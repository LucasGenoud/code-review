#!/usr/bin/env node
// Mock OpenAI-compatible LLM for local development and UI testing.
// Returns plausible findings, summaries, descriptions, rule changes and chat
// answers derived from the prompt, so every flow works without an API key.
//
// Usage: node scripts/mock-llm.mjs [port]   (default 4010)
// In the app: Settings → add provider "OpenAI-compatible",
//   base URL http://localhost:4010/v1 (Docker: http://host.docker.internal:4010/v1),
//   model "mock-reviewer".
import http from "node:http";

const PORT = Number(process.argv[2] ?? 4010);
const MODEL = "mock-reviewer";
const MIN_DELAY_MS = 400;
const MAX_DELAY_MS = 1200;
const MAX_FINDINGS = 2;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const delay = () => sleep(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));

function text(content) {
  if (typeof content === "string") {
    return content;
  }

  return (content ?? []).map((p) => p.text ?? "").join("");
}

// Added lines of the diff section: "   12 + code" → { line: 12, code }.
function addedLines(prompt) {
  const diff = prompt.split(/^## Diff of /m)[1]?.split(/^## /m)[0] ?? "";
  return [...diff.matchAll(/^\s*(\d+) \+ (.*)$/gm)]
    .map((m) => ({ line: Number(m[1]), code: m[2] }))
    .filter((l) => l.code.trim().length > 3);
}

function findings(system, prompt) {
  const rules = [...prompt.matchAll(/^- \[(R\d+)\] \((\w+)\) (.*)$/gm)];
  if (rules.length === 0) {
    return { findings: [] };
  }

  const bugs = /bugs only/i.test(system);
  const picks = addedLines(prompt).filter((_, i) => i % 3 === 0).slice(0, MAX_FINDINGS);

  return {
    findings: picks.map((l, i) => {
      const [, key, severity, ruleText] = rules[i % rules.length];
      const fixable = /print\(|console\.log|==\s*None|var /.test(l.code);
      return {
        rule: key,
        title: bugs ? `Possible failure in line ${l.line}` : `Violates: ${ruleText.slice(0, 50)}`,
        severity,
        startLine: l.line,
        endLine: l.line,
        quote: l.code,
        explanation: `Mock review: this line may conflict with "${ruleText}".`,
        replacement: fixable
          ? l.code.replace("print(", "logging.info(").replace("console.log", "logger.debug").replace("== None", "is None").replace("var ", "let ")
          : null,
        failure: bugs ? "Called with empty input → raises an exception (mock)" : null,
        confidence: bugs ? "possible" : null,
      };
    }),
  };
}

function ruleChanges(prompt) {
  const dismissed = [...prompt.matchAll(/^#(\d+) \[(R\d+)\]/gm)];
  if (dismissed.length === 0) {
    return { changes: [] };
  }

  const [, id, rule] = dismissed[0];
  return {
    changes: [
      {
        kind: "edit",
        rule,
        category: null,
        name: "Rule with exceptions",
        description: "Same rule, except in test files and scripts (mock suggestion)",
        severity: null,
        rationale: "The dismissed finding was in code where the rule doesn't matter.",
        findings: [Number(id)],
      },
    ],
  };
}

function plain(system, prompt) {
  if (/project description/i.test(system)) {
    const name = /## Project name\n(.*)/.exec(prompt)?.[1] ?? "project";
    return `**Purpose**: ${name} (mock description).\n\n**Stack**: detected from the files list.\n\n**Structure**: see the repository tree.\n\n**Conventions**: none detected by the mock.`;
  }

  const files = [...prompt.matchAll(/^- (\S+) \((\w+)/gm)].map((m) => m[1]);
  return `Mock overview: the change touches ${files.length} file(s): ${files.slice(0, 5).join(", ")}.`;
}

function completion(body) {
  const system = body.messages.filter((m) => m.role === "system").map((m) => text(m.content)).join("\n");
  const prompt = body.messages.filter((m) => m.role === "user").map((m) => text(m.content)).join("\n");
  const wantsJson = Boolean(body.response_format) || /Respond with JSON/.test(system);

  if (wantsJson && /"changes"/.test(JSON.stringify(body.response_format ?? "")) || /maintain the rules/.test(system)) {
    return JSON.stringify(ruleChanges(prompt));
  }

  // Usage lookup before the bugs pass: nothing to look up.
  if (/"identifiers"/.test(system)) {
    return JSON.stringify({ identifiers: [] });
  }

  if (wantsJson) {
    return JSON.stringify(findings(system, prompt));
  }

  return plain(system, prompt);
}

function chatAnswer(body) {
  const last = [...body.messages].reverse().find((m) => m.role === "user");
  const question = text(last?.content).slice(0, 120);
  return `Mock answer. You asked: "${question}". A real model would read the code with the tools and explain the finding here.`;
}

function usage(body, out) {
  const prompt = Math.ceil(JSON.stringify(body.messages).length / 4);
  return { prompt_tokens: prompt, completion_tokens: Math.ceil(out.length / 4), total_tokens: prompt + Math.ceil(out.length / 4) };
}

async function stream(res, body, content) {
  res.writeHead(HTTP_OK, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const id = `mock-${Date.now()}`;
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  for (const word of content.split(/(?<= )/)) {
    send({ id, object: "chat.completion.chunk", model: MODEL, choices: [{ index: 0, delta: { content: word } }] });
    await sleep(25);
  }

  send({ id, object: "chat.completion.chunk", model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: usage(body, content) });
  res.end("data: [DONE]\n\n");
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url.endsWith("/models")) {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: MODEL, object: "model" }] }));
    return;
  }

  if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
    res.writeHead(HTTP_NOT_FOUND).end();
    return;
  }

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
  }

  const body = JSON.parse(raw);
  await delay();

  if (body.stream) {
    await stream(res, body, body.tools ? chatAnswer(body) : completion(body));
    return;
  }

  const content = completion(body);
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  res.end(JSON.stringify({
    id: `mock-${Date.now()}`,
    object: "chat.completion",
    model: MODEL,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: usage(body, content),
  }));
});

server.listen(PORT, () => console.log(`Mock LLM on http://localhost:${PORT}/v1 (model "${MODEL}")`));
