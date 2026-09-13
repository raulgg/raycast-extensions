import type { CliPayload } from "./types";

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

export const ERROR_MESSAGES: Record<CliErrorCode, string> = {
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

export function toErrorCode(
  payloadError: string | undefined,
  exitCode: number | string | null | undefined,
): CliErrorCode {
  if (payloadError && (CLI_ERROR_CODES as readonly string[]).includes(payloadError)) {
    return payloadError as CliErrorCode;
  }
  if (typeof exitCode === "number" && exitCode in EXIT_CODE_ERRORS) {
    return EXIT_CODE_ERRORS[exitCode];
  }
  return "unknown";
}
