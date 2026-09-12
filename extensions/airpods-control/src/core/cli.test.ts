import { execFile } from "child_process";
import { accessSync, statSync } from "fs";
import { getPreferenceValues } from "@raycast/api";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { CliError, findCliPath, isCliInstalled, runCli } from "./cli";
import { CLI_SEARCH_PATHS } from "./consts";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("fs", () => ({
  accessSync: vi.fn(),
  statSync: vi.fn(),
  constants: { X_OK: 1 },
}));

const mockExecFile = execFile as unknown as Mock;
const mockAccessSync = vi.mocked(accessSync);
const mockStatSync = vi.mocked(statSync);
const mockGetPreferenceValues = vi.mocked(getPreferenceValues);

type ExecCallback = (error: (Error & { code?: number | string; killed?: boolean }) | null, stdout: string) => void;

function mockExecFileResult(error: (Error & { code?: number | string; killed?: boolean }) | null, stdout: string) {
  mockExecFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: ExecCallback) => {
    callback(error, stdout);
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
    ] as const)("should map exit code %s to %s", async (exitCode, code, message) => {
      const error = new Error("Command failed") as Error & { code?: number };
      error.code = exitCode;
      mockExecFileResult(error, "not json");

      await expect(runCli(["listening-mode", "get"])).rejects.toMatchObject({
        name: "CliError",
        code,
        message,
      });
    });

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

    it("should map the exit code when stdout is not parseable JSON", async () => {
      const error = new Error("Command failed") as Error & { code?: number };
      error.code = 1;
      mockExecFileResult(error, "not json");

      await expect(runCli(["listening-mode", "get"])).rejects.toMatchObject({
        name: "CliError",
        code: "no-device",
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

    it("should report a timeout when the process was killed", async () => {
      const error = new Error("Command failed") as Error & { killed?: boolean };
      error.killed = true;
      mockExecFileResult(error, "");

      await expect(runCli(["listening-mode", "get"])).rejects.toThrow("The airpods-control CLI timed out.");
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
