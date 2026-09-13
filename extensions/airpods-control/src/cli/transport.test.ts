import { execFile } from "child_process";
import { accessSync, statSync } from "fs";
import { getPreferenceValues } from "@raycast/api";
import { expect, vi, type Mock, test } from "vitest";
import { CliError } from "./errors";
import { CLI_SEARCH_PATHS } from "./preferences";
import { runCli } from "./transport";
import type * as Fs from "fs";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  return {
    ...actual,
    accessSync: vi.fn(),
    statSync: vi.fn(),
    constants: { ...actual.constants, X_OK: 1 },
  };
});

const mockExecFile = execFile as unknown as Mock;

const mockAccessSync = vi.mocked(accessSync);

const mockStatSync = vi.mocked(statSync);

const mockGetPreferenceValues = vi.mocked(getPreferenceValues);

type ExecCallback = (
  error: (Error & { code?: number | string | null; killed?: boolean; signal?: string | number | null }) | null,
  stdout: string,
  stderr: string,
) => void;

function mockExecFileResult(
  error: (Error & { code?: number | string | null; killed?: boolean; signal?: string | number | null }) | null,
  stdout: string,
  stderr = "",
) {
  mockExecFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: ExecCallback) => {
    callback(error, stdout, stderr);
  });
}

function mockInstalledAt(...paths: string[]) {
  mockAccessSync.mockImplementation(((path: string) => {
    if (!paths.includes(path)) {
      throw new Error(`ENOENT: ${path}`);
    }
  }) as typeof accessSync);
}

test("throw a not-installed CliError when the binary is missing", async () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  mockInstalledAt();
  // When
  const result = runCli(["listening-mode", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({
    name: "CliError",
    code: "not-installed",
  });
  expect(mockExecFile).not.toHaveBeenCalled();
});

test("run the binary with --json appended and return the parsed payload", async () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  mockExecFileResult(null, '{"device":"My AirPods Pro","listeningMode":"transparency","result":"ok"}');
  // When
  const payload = await runCli(["listening-mode", "get"]);
  // Then
  expect(mockExecFile).toHaveBeenCalledWith(
    CLI_SEARCH_PATHS[0],
    ["listening-mode", "get", "--json"],
    expect.objectContaining({ encoding: "utf-8" }),
    expect.any(Function),
  );
  expect(payload).toEqual({ device: "My AirPods Pro", listeningMode: "transparency", result: "ok" });
});

test("map the payload error identifier when the CLI exits non-zero", async () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  const error = new Error("Command failed") as Error & { code?: number };
  error.code = 4;
  mockExecFileResult(error, '{"device":"Sony","error":"unsupported","listeningMode":null,"result":"error"}');
  // When
  const result = runCli(["listening-mode", "set", "adaptive"]);
  // Then
  await expect(result).rejects.toMatchObject({
    name: "CliError",
    code: "unsupported",
    payload: expect.objectContaining({ error: "unsupported" }),
  });
});

test.each([
  ["read-error", "The CLI could not read AirPods status. Check that your AirPods are connected and try again."],
  [
    "unavailable",
    "AirPods controls are unavailable. Select your AirPods as the audio output and check CLI compatibility.",
  ],
  ["ambiguous-device", "Multiple compatible devices are connected. Disconnect all but one and try again."],
] as const)("map the %s payload error to actionable feedback", async (code, message) => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  const error = new Error("Command failed") as Error & { code?: number };
  error.code = 70;
  mockExecFileResult(error, JSON.stringify({ device: null, error: code, result: "error" }));
  // When
  const result = runCli(["listening-mode", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({
    name: "CliError",
    code,
    message,
  });
});

test.each([
  [5, "read-error", "The CLI could not read AirPods status. Check that your AirPods are connected and try again."],
  [
    6,
    "unavailable",
    "AirPods controls are unavailable. Select your AirPods as the audio output and check CLI compatibility.",
  ],
  [8, "ambiguous-device", "Multiple compatible devices are connected. Disconnect all but one and try again."],
] as const)(
  "should preserve documented exit diagnostics when there is no JSON response (%s)",
  async (exitCode, code, message) => {
    // Given
    mockGetPreferenceValues.mockReturnValue({} as never);
    mockStatSync.mockReturnValue({ isFile: () => true } as never);
    mockInstalledAt();
    mockInstalledAt(CLI_SEARCH_PATHS[0]);
    const error = new Error("Command failed") as Error & { code?: number };
    error.code = exitCode;
    mockExecFileResult(error, "");
    // When
    const result = runCli(["listening-mode", "get"]);
    // Then
    await expect(result).rejects.toMatchObject({
      name: "CliError",
      code,
      message,
    });
  },
);

test("map a no-op result payload without an error token", async () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  const error = new Error("Command failed") as Error & { code?: number };
  error.code = 3;
  mockExecFileResult(
    error,
    JSON.stringify({ device: "My AirPods Pro", listeningMode: "transparency", result: "no-op" }),
  );
  // When
  const result = runCli(["listening-mode", "set", "noise-cancellation"]);
  // Then
  await expect(result).rejects.toMatchObject({
    name: "CliError",
    code: "no-op",
    message: "macOS did not confirm the change.",
    payload: { device: "My AirPods Pro", listeningMode: "transparency", result: "no-op" },
  });
});

test("map a no-op result payload after a zero exit code", async () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  mockExecFileResult(
    null,
    JSON.stringify({ device: "My AirPods Pro", listeningMode: "transparency", result: "no-op" }),
  );
  // When
  const result = runCli(["listening-mode", "set", "noise-cancellation"]);
  // Then
  await expect(result).rejects.toMatchObject({
    name: "CliError",
    code: "no-op",
    message: "macOS did not confirm the change.",
    payload: { device: "My AirPods Pro", listeningMode: "transparency", result: "no-op" },
  });
});

test("reject non-empty malformed JSON before interpreting an exit code", async () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  const error = new Error("Command failed") as Error & { code?: number };
  error.code = 1;
  mockExecFileResult(error, "not json");
  // When
  const result = runCli(["listening-mode", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({
    name: "CliError",
    code: "invalid-response",
  });
});

test("throw an unknown CliError for undocumented exit codes", async () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  const error = new Error("Command failed") as Error & { code?: number };
  error.code = 70;
  mockExecFileResult(error, "");
  // When
  const result = runCli(["listening-mode", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({
    name: "CliError",
    code: "unknown",
  });
});

test("distinguish an externally killed process from a timeout", async () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  const error = new Error("Command failed") as Error & { killed?: boolean; signal?: string };
  error.killed = true;
  error.signal = "SIGKILL";
  mockExecFileResult(error, "", "killed by test");
  // When
  const result = runCli(["listening-mode", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({
    code: "unknown",
    diagnostics: { kind: "killed", signal: "SIGKILL", stderr: "killed by test" },
  });
  // When
  const result2 = runCli(["listening-mode", "get"]);
  // Then
  await expect(result2).rejects.toThrow("terminated by SIGKILL");
});

test("distinguish max-buffer failures from timeouts and killed processes", async () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  const error = new Error("stdout maxBuffer length exceeded") as Error & { code?: string };
  error.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
  mockExecFileResult(error, "", "helper output was truncated");
  // When
  const result = runCli(["listening-mode", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({
    code: "unknown",
    diagnostics: { kind: "max-buffer", stderr: "helper output was truncated" },
  });
  // When
  const result2 = runCli(["listening-mode", "get"]);
  // Then
  await expect(result2).rejects.toThrow("too much output");
});

test("report a timeout separately from a killed process", async () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  vi.useFakeTimers();
  try {
    let callback: ExecCallback | undefined;
    const child = { kill: vi.fn() };
    mockExecFile.mockImplementation((_file: string, _args: string[], _options: unknown, next: ExecCallback) => {
      callback = next;
      return child as never;
    });
    // When
    const pending = runCli(["listening-mode", "get"]);
    await vi.advanceTimersByTimeAsync(15000);
    callback?.(Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" }), "", "slow helper");
    // Then
    await expect(pending).rejects.toMatchObject({
      code: "unknown",
      diagnostics: { kind: "timeout", signal: "SIGTERM", stderr: "slow helper" },
    });
    await expect(pending).rejects.toThrow("timed out");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  } finally {
    vi.useRealTimers();
  }
});

test("preserve a valid interrupted payload and its signal", async () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  const error = new Error("Command interrupted") as Error & { code?: number };
  error.code = 130;
  mockExecFileResult(error, JSON.stringify({ result: "interrupted", signal: 2 }), "interrupted by helper");
  // When
  const result = runCli(["listening-mode", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({
    code: "unknown",
    payload: { result: "interrupted", signal: 2 },
    diagnostics: { kind: "process", signal: 2, stderr: "interrupted by helper" },
  });
});

test("reject a malformed successful envelope instead of classifying it as unsupported", async () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  mockExecFileResult(null, JSON.stringify({ result: "ok", device: "AirPods" }));
  // When
  const result = runCli(["conversation-awareness", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({
    code: "invalid-response",
  });
});

test("reject malformed known field shapes", async () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  mockExecFileResult(
    null,
    JSON.stringify({ result: "ok", device: "AirPods", listeningMode: { mode: "transparency" } }),
  );
  // When
  const result = runCli(["listening-mode", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({ code: "invalid-response" });
});

test("throw when the payload reports an error despite a zero exit code", async () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  mockExecFileResult(null, '{"device":null,"error":"no-device","listeningMode":null,"result":"error"}');
  // When
  const result = runCli(["listening-mode", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({
    name: "CliError",
    code: "no-device",
  });
});

test("expose CliError instances with human-readable messages", async () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  const error = new Error("Command failed") as Error & { code?: number };
  error.code = 1;
  mockExecFileResult(error, '{"device":null,"error":"no-device","listeningMode":null,"result":"error"}');
  try {
    // When
    await runCli(["listening-mode", "get"]);
    expect.unreachable("runCli should have thrown");
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(CliError);
    expect((thrown as CliError).message).toBe("Connect your AirPods to your Mac and try again.");
  }
});
