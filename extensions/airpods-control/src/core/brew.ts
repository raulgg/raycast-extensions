import { execFile } from "child_process";
import { accessSync, constants } from "fs";
import { BREW_SEARCH_PATHS, CLI_BREW_FORMULA, HOMEBREW_URL } from "./consts";

/** Homebrew clones the tap and may build from source; leave generous headroom. */
const BREW_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/** Homebrew shells out to git/curl, which need the standard system PATH that Raycast's process lacks. */
const BREW_PATH_ENV = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");

export function findBrewPath(): string | null {
  for (const candidate of BREW_SEARCH_PATHS) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Missing or not executable; try the next candidate.
    }
  }
  return null;
}

export async function installCliWithBrew(): Promise<void> {
  const brewPath = findBrewPath();
  if (!brewPath) {
    throw new Error(`Homebrew was not found. Install it from ${HOMEBREW_URL} or copy the install command instead.`);
  }

  return new Promise((resolve, reject) => {
    execFile(
      brewPath,
      ["install", CLI_BREW_FORMULA],
      { timeout: BREW_INSTALL_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, PATH: BREW_PATH_ENV } },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        if (error.killed) {
          reject(new Error("brew install timed out."));
          return;
        }
        // brew reports failures on stderr; its last non-empty line carries the actual error.
        const lastLine = stderr
          ?.trim()
          .split("\n")
          .filter((line) => line.trim())
          .pop();
        reject(new Error(lastLine ?? error.message));
      },
    );
  });
}
