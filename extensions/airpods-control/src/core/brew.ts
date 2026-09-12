import { execFile } from "child_process";
import { accessSync, constants, statSync } from "fs";
import { brewLockCommand } from "./brew-lock";
import { BREW_SEARCH_PATHS, CLI_BREW_FORMULA, HOMEBREW_URL } from "./consts";

// The tap builds from source. Include time for downloads and compilation.
const BREW_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const BREW_PATH_ENV = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");

export function findBrewPath(): string | null {
  for (const candidate of BREW_SEARCH_PATHS) {
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next installation prefix.
    }
  }
  return null;
}

export async function findBrewCliPrefix(brewPath: string): Promise<string | null> {
  const installed = await runBrewCommand(brewPath, ["list", "--formula", "--full-name"]);
  if (!installed.split(/\s+/).includes(CLI_BREW_FORMULA)) return null;
  return (await runBrewCommand(brewPath, ["--prefix", CLI_BREW_FORMULA])).trim();
}

export async function installCliWithBrew(): Promise<void> {
  await runBrewCommand(requireBrew(), ["install", CLI_BREW_FORMULA], BREW_INSTALL_TIMEOUT_MS, true);
}

export async function updateCliWithBrew(): Promise<void> {
  await runBrewCommand(requireBrew(), ["upgrade", CLI_BREW_FORMULA], BREW_INSTALL_TIMEOUT_MS, true);
}

function requireBrew(): string {
  const path = findBrewPath();
  if (!path)
    throw new Error(`Homebrew was not found. Install it from ${HOMEBREW_URL}, then choose the Refresh action.`);
  return path;
}

function runBrewCommand(brewPath: string, args: string[], timeout = 15000, exclusive = false): Promise<string> {
  const command = exclusive ? brewLockCommand(brewPath, args) : { file: brewPath, args };
  return new Promise((resolve, reject) => {
    execFile(
      command.file,
      command.args,
      { timeout, maxBuffer: 10 * 1024 * 1024, encoding: "utf8", env: { ...process.env, PATH: BREW_PATH_ENV } },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
        } else if (exclusive && error.code === 75) {
          reject(
            new Error(
              "A helper installation or update is already running. Wait for it to finish, then choose the Refresh action.",
            ),
          );
        } else if (error.killed) {
          reject(
            new Error(`Homebrew ${args[0]} timed out. Check Homebrew in Terminal, then choose the Refresh action.`),
          );
        } else {
          // Keep Homebrew's recovery instructions, which often span several lines.
          reject(new Error(stderr.trim() || error.message));
        }
      },
    );
  });
}
