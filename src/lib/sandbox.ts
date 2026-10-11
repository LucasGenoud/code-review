// Sandbox protocol shared by the app and the runner (sandbox/runner.mjs).
// Client-safe: no server imports.

export enum SandboxLanguage {
  Python = "python",
  JavaScript = "javascript",
  TypeScript = "typescript",
  Java = "java",
}

export enum RunnerState {
  // SANDBOX_DIR not set: no runner deployed.
  Missing = "missing",
  // Configured, but no recent heartbeat.
  Offline = "offline",
  Online = "online",
}

export type SandboxStatus = {
  state: RunnerState;
  enabled: boolean;
  timeoutSeconds: number;
  languages: SandboxLanguage[];
};
