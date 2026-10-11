import { RunnerState, SandboxLanguage, type SandboxStatus } from "@/lib/sandbox";
import { config } from "@/server/config";
import { runJob, runnerInfo } from "@/server/drivers/sandbox";
import { getSandboxSettings } from "./settings";

// Code execution for the chat agent, in the isolated sandbox container.
// Available when enabled in settings AND a runner is alive.

// Heartbeat is every 2 s; older than this = runner down.
const STALE_MS = 6000;
const MS_PER_SECOND = 1000;
const LANGUAGES = new Set<string>(Object.values(SandboxLanguage));

export async function sandboxStatus(): Promise<SandboxStatus> {
  const settings = getSandboxSettings();
  const base = { enabled: settings.enabled, timeoutSeconds: settings.timeoutSeconds };
  const dir = config.sandboxDir;
  if (!dir) {
    return { ...base, state: RunnerState.Missing, languages: [] };
  }

  const info = await runnerInfo(dir);
  if (!info || Date.now() - info.at > STALE_MS) {
    return { ...base, state: RunnerState.Offline, languages: [] };
  }

  const languages = info.languages.filter((l) => LANGUAGES.has(l)) as SandboxLanguage[];
  return { ...base, state: RunnerState.Online, languages };
}

// Usable right now: enabled, runner alive, with these languages.
export async function usableLanguages(): Promise<SandboxLanguage[]> {
  const s = await sandboxStatus();
  return s.enabled && s.state === RunnerState.Online ? s.languages : [];
}

// Runs code against the project (read-only, at $REPO) and formats the
// outcome for the model.
export async function runCode(language: SandboxLanguage, code: string, repo: string): Promise<string> {
  const dir = config.sandboxDir;
  if (!dir || !(await usableLanguages()).includes(language)) {
    return `Error: the sandbox can't run ${language} right now.`;
  }

  const { timeoutSeconds } = getSandboxSettings();
  const result = await runJob(dir, { language, code, repo, timeoutMs: timeoutSeconds * MS_PER_SECOND });
  if (!result) {
    return "Error: the sandbox runner did not respond.";
  }

  if (result.error) {
    return `Error: ${result.error}`;
  }

  const head = result.timedOut
    ? `Timed out after ${timeoutSeconds} s and was killed.`
    : `Exit code ${result.exitCode} in ${result.durationMs} ms.`;

  return [
    head,
    `--- stdout ---\n${result.stdout || "(empty)"}`,
    `--- stderr ---\n${result.stderr || "(empty)"}`,
  ].join("\n");
}
