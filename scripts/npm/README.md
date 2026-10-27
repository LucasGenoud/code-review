# PR Review

Review git diffs of local projects against configurable rules, with any LLM API (OpenAI, Anthropic, or any OpenAI-compatible server such as Ollama or LM Studio).

## Run

Needs [Node.js](https://nodejs.org) 22+ and [git](https://git-scm.com). Works on Windows, macOS and Linux.

```bash
npx @lucasgenoud/code-review
```

It starts on http://localhost:3000 (or the next free port) and opens your browser. Stop it with Ctrl+C.

Install it to get a `code-review` command:

```bash
npm install -g @lucasgenoud/code-review
code-review
```

## Options

| Option | Default |
| --- | --- |
| `--repos <dir>` | Your home folder. Projects can only be added from inside it. |
| `--data <dir>` | Windows `%APPDATA%\code-review`, macOS `~/Library/Application Support/code-review`, Linux `~/.local/share/code-review` |
| `--port <n>` | 3000, or the next free port |
| `--host <addr>` | `127.0.0.1`: only this machine. The app has no login; don't expose it. |
| `--no-open` | Opens the browser |

The code sandbox (running LLM-written code) is off outside Docker, where it would have no isolation. Use the [Docker setup](https://github.com/LucasGenoud/code-review#run-with-docker) for it.
