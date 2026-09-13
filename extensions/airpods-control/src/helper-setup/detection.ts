import { realpathSync } from "fs";
import { join } from "path";
import { findCliPath, getConfiguredCliPath } from "../cli/discovery";
import { findBrewCliPrefix, findBrewPath } from "../homebrew/commands";
import { isBrewOperationRunning } from "../homebrew/lock";
import { detectDeveloperTools, type DeveloperToolsStatus } from "./developer-tools";

export type CliSetupState =
  | "installing"
  | "needs-homebrew"
  | "needs-developer-tools"
  | "invalid-cli-path"
  | "manual-cli"
  | "needs-link"
  | "install"
  | "update";

export interface CliSetup {
  state: CliSetupState;
  cliPath: string | null;
  brewPath: string | null;
  brewCliPrefix: string | null;
  configuredCliPath: string | null;
  developerTools: DeveloperToolsStatus | null;
}

export async function detectCliSetup(): Promise<CliSetup> {
  const cliPath = findCliPath();
  const configuredCliPath = getConfiguredCliPath();
  const brewPath = findBrewPath();
  if (await isBrewOperationRunning()) {
    return { state: "installing", cliPath, configuredCliPath, brewPath, brewCliPrefix: null, developerTools: null };
  }
  const developerTools = await detectDeveloperTools();
  // Missing tools have their own recovery screen, including when brew cannot run yet.
  const brewCliPrefix = brewPath && developerTools === "ready" ? await findBrewCliPrefix(brewPath) : null;
  const details = { cliPath, configuredCliPath, brewPath, developerTools, brewCliPrefix };
  if (configuredCliPath && !cliPath) return { ...details, state: "invalid-cli-path" };
  if (developerTools !== "ready") return { ...details, state: "needs-developer-tools" };
  if (!brewPath) return { ...details, state: cliPath ? "manual-cli" : "needs-homebrew" };
  if (cliPath) {
    const managed = brewCliPrefix && sameFile(cliPath, join(brewCliPrefix, "bin", "airpods-control"));
    return { ...details, state: managed ? "update" : "manual-cli" };
  }
  return { ...details, state: brewCliPrefix ? "needs-link" : "install" };
}

function sameFile(first: string, second: string): boolean {
  try {
    return realpathSync(first) === realpathSync(second);
  } catch {
    return false;
  }
}
