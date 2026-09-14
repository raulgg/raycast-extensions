import type { CliSetup } from "../../helper-setup/detection";

export function cliSetup(overrides: Partial<CliSetup> = {}): CliSetup {
  return {
    state: "install",
    cliPath: null,
    brewPath: "/opt/homebrew/bin/brew",
    brewCliPrefix: null,
    configuredCliPath: null,
    developerTools: "ready",
    installedVersion: null,
    latestVersion: null,
    latestSource: null,
    liveCheckFailed: false,
    installationMethod: null,
    versionStatus: "unknown",
    ...overrides,
  };
}

export function installedCliSetup(overrides: Partial<CliSetup> = {}): CliSetup {
  return cliSetup({
    state: "update",
    cliPath: "/opt/homebrew/bin/airpods-control",
    brewCliPrefix: "/opt/homebrew/opt/airpods-control",
    installedVersion: "0.4.0",
    latestVersion: "0.4.0",
    latestSource: "homebrew",
    liveCheckFailed: false,
    installationMethod: "homebrew",
    versionStatus: "up-to-date",
    ...overrides,
  });
}

export function outdatedCliSetup(overrides: Partial<CliSetup> = {}): CliSetup {
  return installedCliSetup({
    installedVersion: "0.3.0",
    versionStatus: "update-available",
    ...overrides,
  });
}
