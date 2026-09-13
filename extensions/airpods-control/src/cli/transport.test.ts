import { execFile } from "child_process";
import { accessSync, statSync } from "fs";
import { getPreferenceValues } from "@raycast/api";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { CLI_SEARCH_PATHS } from "./preferences";
import { CliError, findCliPath, isCliInstalled, runCli } from "./transport";
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

describe("cli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPreferenceValues.mockReturnValue({} as never);
    mockStatSync.mockReturnValue({ isFile: () => true } as never);
    mockInstalledAt();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("findCliPath", () => {
    it("should return the Homebrew path when the binary is there", () => {
      mockInstalledAt(CLI_SEARCH_PATHS[0]);

      expect(findCliPath()).toBe(CLI_SEARCH_PATHS[0]);
    });

    it("should fall back to the next search path", () => {
      mockInstalledAt(CLI_SEARCH_PATHS[1]);

      expect(findCliPath()).toBe(CLI_SEARCH_PATHS[1]);
    });

    it("should return null when the binary is nowhere to be found", () => {
      expect(findCliPath()).toBeNull();
    });

    it("should use the CLI Path preference when set", () => {
      mockGetPreferenceValues.mockReturnValue({ cliPath: "/custom/bin/airpods-control" } as never);
      mockInstalledAt("/custom/bin/airpods-control");

      expect(findCliPath()).toBe("/custom/bin/airpods-control");
    });

    it("should not fall back to default paths when the CLI Path preference is invalid", () => {
      mockGetPreferenceValues.mockReturnValue({ cliPath: "/custom/bin/airpods-control" } as never);
      mockInstalledAt(CLI_SEARCH_PATHS[0]);

      expect(findCliPath()).toBeNull();
    });

    it("should reject a CLI Path preference that points at a directory", () => {
      mockGetPreferenceValues.mockReturnValue({ cliPath: "/opt/homebrew/bin" } as never);
      mockInstalledAt("/opt/homebrew/bin");
      mockStatSync.mockReturnValue({ isFile: () => false } as never);

      expect(findCliPath()).toBeNull();
    });

    it("should ignore a whitespace-only CLI Path preference", () => {
      mockGetPreferenceValues.mockReturnValue({ cliPath: "   " } as never);
      mockInstalledAt(CLI_SEARCH_PATHS[0]);

      expect(findCliPath()).toBe(CLI_SEARCH_PATHS[0]);
    });
  });

  describe("isCliInstalled", () => {
    it("should mirror findCliPath", () => {
      expect(isCliInstalled()).toBe(false);

      mockInstalledAt(CLI_SEARCH_PATHS[0]);
      expect(isCliInstalled()).toBe(true);
    });
  });

  describe("runCli", () => {
    beforeEach(() => {
      mockInstalledAt(CLI_SEARCH_PATHS[0]);
    });

    it("should throw a not-installed CliError when the binary is missing", async () => {
      mockInstalledAt();

      await expect(runCli(["listening-mode", "get"])).rejects.toMatchObject({
        name: "CliError",
        code: "not-installed",
      });
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it("should run the binary with --json appended and return the parsed payload", async () => {
      mockExecFileResult(null, '{"device":"My AirPods Pro","listeningMode":"transparency","result":"ok"}');

      const payload = await runCli(["listening-mode", "get"]);

      expect(mockExecFile).toHaveBeenCalledWith(
        CLI_SEARCH_PATHS[0],
        ["listening-mode", "get", "--json"],
        expect.objectContaining({ encoding: "utf-8" }),
        expect.any(Function),
      );
      expect(payload).toEqual({ device: "My AirPods Pro", listeningMode: "transparency", result: "ok" });
    });

    it("should map the payload error identifier when the CLI exits non-zero", async () => {
      const error = new Error("Command failed") as Error & { code?: number };
      error.code = 4;
      mockExecFileResult(error, '{"device":"Sony","error":"unsupported","listeningMode":null,"result":"error"}');

      await expect(runCli(["listening-mode", "set", "adaptive"])).rejects.toMatchObject({
        name: "CliError",
        code: "unsupported",
        payload: expect.objectContaining({ error: "unsupported" }),
      });
    });

    it.each([
      ["read-error", "The CLI could not read AirPods status. Check that your AirPods are connected and try again."],
      [
        "unavailable",
        "AirPods controls are unavailable. Select your AirPods as the audio output and check CLI compatibility.",
      ],
      ["ambiguous-device", "Multiple compatible devices are connected. Disconnect all but one and try again."],
    ] as const)("should map the %s payload error to actionable feedback", async (code, message) => {
      const error = new Error("Command failed") as Error & { code?: number };
      error.code = 70;
      mockExecFileResult(error, JSON.stringify({ device: null, error: code, result: "error" }));

      await expect(runCli(["listening-mode", "get"])).rejects.toMatchObject({
        name: "CliError",
        code,
        message,
      });
    });

    it.each([
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
        const error = new Error("Command failed") as Error & { code?: number };
        error.code = exitCode;
        mockExecFileResult(error, "");

        await expect(runCli(["listening-mode", "get"])).rejects.toMatchObject({
          name: "CliError",
          code,
          message,
        });
      },
    );

    it("should map a no-op result payload without an error token", async () => {
      const error = new Error("Command failed") as Error & { code?: number };
      error.code = 3;
      mockExecFileResult(
        error,
        JSON.stringify({ device: "My AirPods Pro", listeningMode: "transparency", result: "no-op" }),
      );

      await expect(runCli(["listening-mode", "set", "noise-cancellation"])).rejects.toMatchObject({
        name: "CliError",
        code: "no-op",
        message: "macOS did not confirm the change.",
        payload: { device: "My AirPods Pro", listeningMode: "transparency", result: "no-op" },
      });
    });

    it("should map a no-op result payload after a zero exit code", async () => {
      mockExecFileResult(
        null,
        JSON.stringify({ device: "My AirPods Pro", listeningMode: "transparency", result: "no-op" }),
      );

      await expect(runCli(["listening-mode", "set", "noise-cancellation"])).rejects.toMatchObject({
        name: "CliError",
        code: "no-op",
        message: "macOS did not confirm the change.",
        payload: { device: "My AirPods Pro", listeningMode: "transparency", result: "no-op" },
      });
    });

    it("should reject non-empty malformed JSON before interpreting an exit code", async () => {
      const error = new Error("Command failed") as Error & { code?: number };
      error.code = 1;
      mockExecFileResult(error, "not json");

      await expect(runCli(["listening-mode", "get"])).rejects.toMatchObject({
        name: "CliError",
        code: "invalid-response",
      });
    });

    it("should throw an unknown CliError for undocumented exit codes", async () => {
      const error = new Error("Command failed") as Error & { code?: number };
      error.code = 70;
      mockExecFileResult(error, "");

      await expect(runCli(["listening-mode", "get"])).rejects.toMatchObject({
        name: "CliError",
        code: "unknown",
      });
    });

    it("should distinguish an externally killed process from a timeout", async () => {
      const error = new Error("Command failed") as Error & { killed?: boolean; signal?: string };
      error.killed = true;
      error.signal = "SIGKILL";
      mockExecFileResult(error, "", "killed by test");

      await expect(runCli(["listening-mode", "get"])).rejects.toMatchObject({
        code: "unknown",
        diagnostics: { kind: "killed", signal: "SIGKILL", stderr: "killed by test" },
      });
      await expect(runCli(["listening-mode", "get"])).rejects.toThrow("terminated by SIGKILL");
    });

    it("should distinguish max-buffer failures from timeouts and killed processes", async () => {
      const error = new Error("stdout maxBuffer length exceeded") as Error & { code?: string };
      error.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
      mockExecFileResult(error, "", "helper output was truncated");

      await expect(runCli(["listening-mode", "get"])).rejects.toMatchObject({
        code: "unknown",
        diagnostics: { kind: "max-buffer", stderr: "helper output was truncated" },
      });
      await expect(runCli(["listening-mode", "get"])).rejects.toThrow("too much output");
    });

    it("should report a timeout separately from a killed process", async () => {
      vi.useFakeTimers();
      try {
        let callback: ExecCallback | undefined;
        const child = { kill: vi.fn() };
        mockExecFile.mockImplementation((_file: string, _args: string[], _options: unknown, next: ExecCallback) => {
          callback = next;
          return child as never;
        });

        const pending = runCli(["listening-mode", "get"]);
        await vi.advanceTimersByTimeAsync(15000);
        callback?.(Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" }), "", "slow helper");

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

    it("should preserve a valid interrupted payload and its signal", async () => {
      const error = new Error("Command interrupted") as Error & { code?: number };
      error.code = 130;
      mockExecFileResult(error, JSON.stringify({ result: "interrupted", signal: 2 }), "interrupted by helper");

      await expect(runCli(["listening-mode", "get"])).rejects.toMatchObject({
        code: "unknown",
        payload: { result: "interrupted", signal: 2 },
        diagnostics: { kind: "process", signal: 2, stderr: "interrupted by helper" },
      });
    });

    it("should reject a malformed successful envelope instead of classifying it as unsupported", async () => {
      mockExecFileResult(null, JSON.stringify({ result: "ok", device: "AirPods" }));

      await expect(runCli(["conversation-awareness", "get"])).rejects.toMatchObject({
        code: "invalid-response",
      });
    });

    it("should reject malformed known field shapes", async () => {
      mockExecFileResult(
        null,
        JSON.stringify({ result: "ok", device: "AirPods", listeningMode: { mode: "transparency" } }),
      );

      await expect(runCli(["listening-mode", "get"])).rejects.toMatchObject({ code: "invalid-response" });
    });

    it("should throw when the payload reports an error despite a zero exit code", async () => {
      mockExecFileResult(null, '{"device":null,"error":"no-device","listeningMode":null,"result":"error"}');

      await expect(runCli(["listening-mode", "get"])).rejects.toMatchObject({
        name: "CliError",
        code: "no-device",
      });
    });

    it("should expose CliError instances with human-readable messages", async () => {
      const error = new Error("Command failed") as Error & { code?: number };
      error.code = 1;
      mockExecFileResult(error, '{"device":null,"error":"no-device","listeningMode":null,"result":"error"}');

      try {
        await runCli(["listening-mode", "get"]);
        expect.unreachable("runCli should have thrown");
      } catch (thrown) {
        expect(thrown).toBeInstanceOf(CliError);
        expect((thrown as CliError).message).toBe("Connect your AirPods to your Mac and try again.");
      }
    });
  });
});
