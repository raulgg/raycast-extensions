import { execFile, type ExecFileOptions } from "child_process";
import { findCliPath } from "./discovery";
import { CliError, ERROR_MESSAGES, toErrorCode, type CliDiagnostics, type CliProcessFailureKind } from "./errors";
import { parseCliPayload } from "./protocol";
import type { CliPayload } from "./types";

/**
 * Non-zero writes are verified by the CLI for up to ~1.5s; leave generous headroom
 * so a slow device settle never surfaces as a spurious timeout.
 */
const CLI_TIMEOUT_MS = 15000;
const CLI_MAX_BUFFER_BYTES = 64 * 1024;
const CLI_DIAGNOSTIC_LIMIT = 4096;

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
