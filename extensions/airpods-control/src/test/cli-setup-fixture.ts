import type { CliSetup } from "../core/cli-setup";

export function cliSetup(overrides: Partial<CliSetup> = {}): CliSetup {
  return {
    state: "install",
    cliPath: null,
    brewPath: "/opt/homebrew/bin/brew",
    brewCliPrefix: null,
    configuredCliPath: null,
    developerTools: "ready",
    ...overrides,
  };
}

export const installedCli = cliSetup({
  state: "update",
  cliPath: "/opt/homebrew/bin/airpods-control",
  brewCliPrefix: "/opt/homebrew/opt/airpods-control",
});

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
