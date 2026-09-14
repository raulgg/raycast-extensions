import { normalizeVersion } from "../cli/version";
import { CLI_GITHUB_RELEASES_LATEST_URL, CLI_VERSION } from "./constants";

const GITHUB_RELEASES_TIMEOUT_MS = 8000;
const GITHUB_USER_AGENT = "airpods-control-raycast-extension";

export interface LatestRelease {
  version: string | null;
  source: "github" | "local";
  liveCheckFailed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function localRelease(): LatestRelease {
  return { version: normalizeVersion(CLI_VERSION), source: "local", liveCheckFailed: true };
}

/**
 * Fetch the latest GitHub release tag. Any network, HTTP, or parse failure
 * falls back to the local CLI version. Never throws.
 */
export async function fetchLatestGithubRelease(): Promise<LatestRelease> {
  const fallback = localRelease();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_RELEASES_TIMEOUT_MS);
  try {
    const response = await fetch(CLI_GITHUB_RELEASES_LATEST_URL, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": GITHUB_USER_AGENT,
      },
    });
    if (!response.ok) return fallback;
    const body: unknown = await response.json();
    if (!isRecord(body) || typeof body.tag_name !== "string") return fallback;
    const version = normalizeVersion(body.tag_name);
    if (!version) return fallback;
    return { version, source: "github", liveCheckFailed: false };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
