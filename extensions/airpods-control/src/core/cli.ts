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
const CLI_MAX_BUFFER_BYTES = 64 * 1024;
const CLI_DIAGNOSTIC_LIMIT = 4096;

export type CliErrorCode =
  | "not-installed"
  | "no-device"
  | "bad-args"
  | "no-op"
  | "unsupported"
  | "read-error"
  | "unavailable"
  | "state-uncertain"
  | "ambiguous-device"
  | "invalid-response"
  | "unknown";

const CLI_ERROR_CODES = [
  "no-device",
  "bad-args",
  "no-op",
  "unsupported",
  "read-error",
  "unavailable",
  "state-uncertain",
  "ambiguous-device",
] as const;

const EXIT_CODE_ERRORS: Record<number, CliErrorCode> = {
  1: "no-device",
  2: "bad-args",
  3: "no-op",
  4: "unsupported",
  5: "read-error",
  6: "unavailable",
  7: "state-uncertain",
  8: "ambiguous-device",
};

const ERROR_MESSAGES: Record<CliErrorCode, string> = {
  "not-installed": "The airpods-control CLI is not installed.",
  "no-device": "Connect your AirPods to your Mac and try again.",
  "bad-args": "The airpods-control CLI rejected the command arguments.",
  "no-op": "macOS did not confirm the change.",
  unsupported: "This feature is not supported by the connected device.",
  "read-error": "The CLI could not read AirPods status. Check that your AirPods are connected and try again.",
  unavailable: "AirPods controls are unavailable. Select your AirPods as the audio output and check CLI compatibility.",
  "state-uncertain": "The CLI could not confirm the final AirPods state.",
  "ambiguous-device": "Multiple compatible devices are connected. Disconnect all but one and try again.",
  "invalid-response": "The airpods-control CLI returned an invalid response.",
  unknown: "The airpods-control CLI failed unexpectedly.",
};

export type CliProcessFailureKind = "timeout" | "max-buffer" | "killed" | "process";

/**
 * Bounded information about a child-process failure. The command and its
 * environment are intentionally omitted; stderr is the only helper output
 * retained, and it is capped before it reaches a toast or copied error.
 */
export interface CliDiagnostics {
  kind: CliProcessFailureKind;
  stderr: string;
  exitCode: number | string | null;
  signal: string | number | null;
}

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly payload: CliPayload | null;
  readonly diagnostics: CliDiagnostics | null;

  constructor(
    code: CliErrorCode,
    payload: CliPayload | null = null,
    messageOverride?: string,
    diagnostics: CliDiagnostics | null = null,
  ) {
    super(messageOverride ?? ERROR_MESSAGES[code]);
    this.name = "CliError";
    this.code = code;
    this.payload = payload;
    this.diagnostics = diagnostics;
  }
}

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

interface ExecError extends Error {
  code?: number | string | null;
  killed?: boolean;
  signal?: string | number | null;
}

interface ExecFileResult {
  stdout: string;
  stderr: string;
  error: ExecError | null;
  timedOut: boolean;
}

function outputString(output: unknown): string {
  return typeof output === "string" ? output : String(output ?? "");
}

function execFileAsync(file: string, args: string[], options: ExecFileOptions): Promise<ExecFileResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (error: ExecError | null, stdout: unknown, stderr: unknown) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      resolve({ stdout: outputString(stdout), stderr: outputString(stderr), error, timedOut });
    };

    try {
      const { timeout, ...execOptions } = options;
      const child = execFile(file, args, { ...execOptions, encoding: "utf-8" }, (error, stdout, stderr) => {
        finish(error as ExecError | null, stdout, stderr);
      });

      // Own the timeout so a helper killed by an external signal remains
      // distinguishable from a timeout. Node's `execFile` timeout only reports
      // both cases as `killed`.
      if (!settled && typeof timeout === "number" && timeout > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          child?.kill("SIGTERM");
        }, timeout);
      }
    } catch (error) {
      finish(error as ExecError, "", "");
    }
  });
}

type CliResource = "listeningMode" | "conversationAwareness";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function resourceForArgs(args: readonly string[]): CliResource | undefined {
  if (args.includes("listening-mode")) return "listeningMode";
  if (args.includes("conversation-awareness")) return "conversationAwareness";
  return undefined;
}

/**
 * Validate the JSON envelope emitted by the helper. JSON.parse intentionally
 * returns unknown here: the CLI is an external process and its output cannot
 * be trusted merely because it is valid JSON.
 *
 * The resource argument makes the command-specific state requirement explicit.
 * A field with JSON null is valid readback; an omitted field is a schema error.
 */
export function validateCliPayload(value: unknown, args: readonly string[] = []): CliPayload | null {
  if (!isRecord(value)) return null;

  const result = value.result;
  if (result !== "ok" && result !== "error" && result !== "no-op" && result !== "interrupted") return null;

  if (hasOwn(value, "supportedListeningModes") && !isStringArray(value.supportedListeningModes)) return null;
  if (hasOwn(value, "listeningMode") && !isNullableString(value.listeningMode)) return null;
  if (hasOwn(value, "conversationAwareness") && !isNullableString(value.conversationAwareness)) return null;
  if (result === "interrupted") {
    if (!hasOwn(value, "signal") || typeof value.signal !== "number" || !Number.isInteger(value.signal)) return null;
    if (value.signal <= 0) return null;
    if (hasOwn(value, "error")) return null;
    if (hasOwn(value, "device") && !isNullableString(value.device)) return null;
    return value as unknown as CliPayload;
  }

  if (!hasOwn(value, "device") || !isNullableString(value.device)) return null;
  if (hasOwn(value, "signal")) return null;

  if (result === "error") {
    if (typeof value.error !== "string" || value.error.length === 0) return null;
  } else if (hasOwn(value, "error")) {
    return null;
  }

  const resource = resourceForArgs(args);
  // Error payloads are useful even when an older helper omits its optional
  // readback field. Successful and no-op resource responses, however, must
  // carry the command-specific field so a schema drift cannot be mistaken for
  // unsupported hardware.
  if (resource && (result === "ok" || result === "no-op") && !hasOwn(value, resource)) return null;
  return value as unknown as CliPayload;
}

/** Parse and validate a helper response. Invalid JSON and invalid envelopes return null. */
export function parseCliPayload(stdout: string, args: readonly string[] = []): CliPayload | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return validateCliPayload(parsed, args);
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

function boundedText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= CLI_DIAGNOSTIC_LIMIT) return trimmed;
  return `${trimmed.slice(0, CLI_DIAGNOSTIC_LIMIT)}…`;
}

function isMaxBufferError(error: ExecError): boolean {
  return error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || /maxbuffer/i.test(error.message);
}

function processFailureKind(error: ExecError, timedOut: boolean): CliProcessFailureKind {
  if (isMaxBufferError(error)) return "max-buffer";
  if (timedOut) return "timeout";
  if (error.killed === true || (error.signal !== null && error.signal !== undefined)) return "killed";
  return "process";
}

function diagnosticsFor(
  error: ExecError,
  stderr: string,
  timedOut: boolean,
  payload: CliPayload | null,
): CliDiagnostics {
  return {
    kind: processFailureKind(error, timedOut),
    stderr: boundedText(stderr),
    exitCode: typeof error.code === "number" || typeof error.code === "string" ? error.code : null,
    signal:
      typeof error.signal === "number" || typeof error.signal === "string"
        ? error.signal
        : payload?.result === "interrupted"
          ? payload.signal
          : null,
  };
}

function diagnosticsMessage(diagnostics: CliDiagnostics): string {
  const details: string[] = [];
  if (diagnostics.exitCode !== null) details.push(`Exit status: ${diagnostics.exitCode}`);
  if (diagnostics.signal !== null) details.push(`Signal: ${diagnostics.signal}`);
  if (diagnostics.stderr) details.push(`stderr: ${diagnostics.stderr}`);
  return details.join("\n");
}

function processFailureMessage(diagnostics: CliDiagnostics): string {
  const base =
    diagnostics.kind === "timeout"
      ? "The airpods-control CLI timed out."
      : diagnostics.kind === "max-buffer"
        ? "The airpods-control CLI produced too much output."
        : diagnostics.kind === "killed"
          ? `The airpods-control CLI was terminated${diagnostics.signal === null ? "" : ` by ${diagnostics.signal}`}.`
          : ERROR_MESSAGES.unknown;
  const details = diagnosticsMessage(diagnostics);
  return details ? `${base}\n\nCLI diagnostics:\n${details}` : base;
}

function invalidResponse(payload: CliPayload | null = null, diagnostics: CliDiagnostics | null = null): never {
  const details = diagnostics ? diagnosticsMessage(diagnostics) : "";
  const message = details ? `${ERROR_MESSAGES["invalid-response"]}\n\nCLI diagnostics:\n${details}` : undefined;
  throw new CliError("invalid-response", payload, message, diagnostics);
}

export async function runCli(args: string[]): Promise<CliPayload> {
  const cliPath = findCliPath();
  if (!cliPath) {
    throw new CliError("not-installed");
  }

  const { stdout, stderr, error, timedOut } = await execFileAsync(cliPath, [...args, "--json"], {
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: CLI_MAX_BUFFER_BYTES,
  });
  const rawResponse = stdout.trim();
  const payload = parseCliPayload(stdout, args);

  if (error) {
    const diagnostics = diagnosticsFor(error, stderr, timedOut, payload);

    // A timed-out, truncated, or externally terminated process has no reliable
    // command result, even if it happened to write a partial JSON fragment.
    if (diagnostics.kind === "timeout" || diagnostics.kind === "max-buffer" || diagnostics.kind === "killed") {
      throw new CliError("unknown", payload, processFailureMessage(diagnostics), diagnostics);
    }

    // Any non-empty malformed response is a schema failure. Do not let an
    // unrelated exit status turn it into (for example) "unsupported".
    if (rawResponse && !payload) invalidResponse(null, diagnostics);

    if (payload?.result === "no-op") {
      throw new CliError("no-op", payload, undefined, diagnostics);
    }
    if (payload?.result === "interrupted") {
      throw new CliError("unknown", payload, processFailureMessage({ ...diagnostics, kind: "killed" }), diagnostics);
    }
    if (payload?.result === "error") {
      const code = toErrorCode(payload.error, error.code);
      const message = code === "unknown" ? processFailureMessage(diagnostics) : ERROR_MESSAGES[code];
      throw new CliError(code, payload, message, diagnostics);
    }

    // With no response at all, a documented numeric exit status is still the
    // best available classification. Diagnostics preserve why the process
    // failed without leaking the executable path or invocation arguments.
    const code = toErrorCode(undefined, error.code);
    throw new CliError(
      code,
      null,
      code === "unknown" ? processFailureMessage(diagnostics) : ERROR_MESSAGES[code],
      diagnostics,
    );
  }

  if (!payload) invalidResponse();
  if (payload.result === "no-op") {
    throw new CliError("no-op", payload);
  }
  if (payload.result === "interrupted") {
    throw new CliError("unknown", payload, `The airpods-control CLI was interrupted by signal ${payload.signal}.`);
  }
  if (payload.result !== "ok") {
    const code = toErrorCode(payload.error, undefined);
    throw new CliError(code, payload);
  }

  return payload;
}
