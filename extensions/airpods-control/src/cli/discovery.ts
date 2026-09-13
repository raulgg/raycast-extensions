import { accessSync, constants, statSync } from "fs";
import { getPreferenceValues } from "@raycast/api";
import { CLI_SEARCH_PATHS, type ExtensionPreferences } from "./preferences";

export function getConfiguredCliPath(): string | null {
  const preferences = getPreferenceValues<ExtensionPreferences>();
  return preferences.cliPath?.trim() || null;
}

export function findCliPath(): string | null {
  const customPath = getConfiguredCliPath();
  const candidates = customPath ? [customPath] : CLI_SEARCH_PATHS;

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      // Directories also pass the X_OK check; only accept regular files.
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Missing or not executable; try the next candidate.
    }
  }
  return null;
}

export function isCliInstalled(): boolean {
  return findCliPath() !== null;
}
