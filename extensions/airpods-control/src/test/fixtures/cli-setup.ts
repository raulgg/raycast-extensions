import type { CliSetup } from "../../helper-setup/detection";

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

export function installedCliSetup(): CliSetup {
  return cliSetup({
    state: "update",
    cliPath: "/opt/homebrew/bin/airpods-control",
    brewCliPrefix: "/opt/homebrew/opt/airpods-control",
  });
}
