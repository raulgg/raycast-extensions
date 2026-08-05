import { execFile, type ExecFileOptions } from "child_process";
import { accessSync, constants, statSync } from "fs";
import { getPreferenceValues } from "@raycast/api";
import { CLI_SEARCH_PATHS } from "./consts";
import type { CliPayload, ExtensionPreferences } from "./types";

/**
 * Non-zero writes are verified by the CLI for up to ~1.5s; leave generous headroom
 * so a slow device settle never surfaces as a spurious timeout.
 */
const CLI_TIMEOUT_MS = 15000;

export type CliErrorCode =
  "not-installed" | "no-device" | "bad-args" | "no-op" | "unsupported" | "invalid-response" | "unknown";

const CLI_ERROR_CODES = ["no-device", "bad-args", "no-op", "unsupported"] as const;

const EXIT_CODE_ERRORS: Record<number, CliErrorCode> = {
  1: "no-device",
  2: "bad-args",
  3: "no-op",
  4: "unsupported",
};

const ERROR_MESSAGES: Record<CliErrorCode, string> = {
  "not-installed": "The airpods-control CLI is not installed.",
  "no-device": "Connect your AirPods to your Mac and try again.",
  "bad-args": "The airpods-control CLI rejected the command arguments.",
  "no-op": "Your AirPods did not confirm the change.",
  unsupported: "This feature is not supported by the connected device.",
  "invalid-response": "The airpods-control CLI returned an invalid response.",
  unknown: "The airpods-control CLI failed unexpectedly.",
};

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly payload: CliPayload | null;

  constructor(code: CliErrorCode, payload: CliPayload | null = null, messageOverride?: string) {
    super(messageOverride ?? ERROR_MESSAGES[code]);
    this.name = "CliError";
    this.code = code;
    this.payload = payload;
  }
}

export function findCliPath(): string | null {
  const preferences = getPreferenceValues<ExtensionPreferences>();
  const customPath = preferences.cliPath?.trim();
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

interface ExecFileResult {
  stdout: string;
  error: (Error & { code?: number | string | null; killed?: boolean }) | null;
}

function execFileAsync(file: string, args: string[], options: ExecFileOptions): Promise<ExecFileResult> {
  return new Promise((resolve) => {
    execFile(file, args, { ...options, encoding: "utf-8" }, (error, stdout) => {
      resolve({ stdout: typeof stdout === "string" ? stdout : String(stdout), error });
    });
  });
}

function parsePayload(stdout: string): CliPayload | null {
  try {
    return JSON.parse(stdout) as CliPayload;
  } catch {
    return null;
  }
}

function toErrorCode(payloadError: string | undefined, exitCode: number | string | null | undefined): CliErrorCode {
  if (payloadError && (CLI_ERROR_CODES as readonly string[]).includes(payloadError)) {
    return payloadError as CliErrorCode;
  }
  if (typeof exitCode === "number" && exitCode in EXIT_CODE_ERRORS) {
    return EXIT_CODE_ERRORS[exitCode];
  }
  return "unknown";
}

export async function runCli(args: string[]): Promise<CliPayload> {
  const cliPath = findCliPath();
  if (!cliPath) {
    throw new CliError("not-installed");
  }

  const { stdout, error } = await execFileAsync(cliPath, [...args, "--json"], { timeout: CLI_TIMEOUT_MS });
  const payload = parsePayload(stdout);

  if (error) {
    if (error.killed) {
      throw new CliError("unknown", payload, "The airpods-control CLI timed out.");
    }
    throw new CliError(toErrorCode(payload?.error, error.code), payload);
  }

  if (!payload || payload.result !== "ok") {
    throw new CliError(toErrorCode(payload?.error, undefined), payload);
  }

  return payload;
}
