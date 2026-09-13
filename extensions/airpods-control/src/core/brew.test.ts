import { execFile } from "child_process";
import { accessSync, statSync } from "fs";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { findBrewCliPrefix, findBrewPath, installCliWithBrew, updateCliWithBrew } from "./brew";
import { acquireBrewLock } from "./brew-lock";
import { BREW_SEARCH_PATHS, CLI_BREW_FORMULA } from "./consts";
import { runProcessWithLifetime, type ProcessLifetimeResult } from "./process-lifetime";

vi.mock("./brew-lock", () => ({
  acquireBrewLock: vi.fn().mockResolvedValue(undefined),
  brewLockSupervisorCommand: (file: string, args: string[]) => ({
    file: "/bin/bash",
    args: ["-c", "supervisor", "airpods-control-brew-supervisor", file, ...args],
  }),
  openBrewLock: vi.fn(() => 42),
}));
vi.mock("./process-lifetime", () => ({ runProcessWithLifetime: vi.fn() }));
vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("fs", () => ({
  accessSync: vi.fn(),
  closeSync: vi.fn(),
  statSync: vi.fn(() => ({ isFile: () => true })),
  constants: { X_OK: 1 },
}));

const mockExecFile = execFile as unknown as Mock;
const mockAccessSync = vi.mocked(accessSync);
const mockAcquireBrewLock = vi.mocked(acquireBrewLock);
const mockRunProcessWithLifetime = vi.mocked(runProcessWithLifetime);

type ExecCallback = (error: (Error & { killed?: boolean }) | null, stdout: string, stderr: string) => void;

function mockExecFileResult(error: (Error & { killed?: boolean }) | null, stderr = "", stdout = "") {
  mockExecFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: ExecCallback) => {
    callback(error, stdout, stderr);
  });
}

function mockBrewAt(...paths: string[]) {
  mockAccessSync.mockImplementation(((path: string) => {
    if (!paths.includes(path)) {
      throw new Error(`ENOENT: ${path}`);
    }
  }) as typeof accessSync);
}

function mockProcessResult(overrides: Partial<ProcessLifetimeResult> = {}) {
  mockRunProcessWithLifetime.mockResolvedValue({
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
    timedOut: false,
    outputLimitExceeded: false,
    ...overrides,
  });
}

describe("brew", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrewAt();
    mockAcquireBrewLock.mockResolvedValue(undefined);
    mockProcessResult();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("findBrewPath", () => {
    it("should return the Apple Silicon path when brew is there", () => {
      mockBrewAt(BREW_SEARCH_PATHS[0]);

      expect(findBrewPath()).toBe(BREW_SEARCH_PATHS[0]);
    });

    it("should fall back to the Intel path", () => {
      mockBrewAt(BREW_SEARCH_PATHS[1]);

      expect(findBrewPath()).toBe(BREW_SEARCH_PATHS[1]);
    });

    it("should return null when brew is nowhere to be found", () => {
      expect(findBrewPath()).toBeNull();
    });
  });

  describe("installCliWithBrew", () => {
    it("should reject with a brew.sh hint when Homebrew is missing", async () => {
      await expect(installCliWithBrew()).rejects.toThrow(/brew\.sh/);
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it("should run brew install with the CLI formula", async () => {
      mockBrewAt(BREW_SEARCH_PATHS[0]);

      await installCliWithBrew();

      expect(mockRunProcessWithLifetime).toHaveBeenCalledWith(
        "/bin/bash",
        ["-c", "supervisor", "airpods-control-brew-supervisor", BREW_SEARCH_PATHS[0], "install", CLI_BREW_FORMULA],
        expect.anything(),
      );
    });

    it("should run brew upgrade with the CLI formula", async () => {
      mockBrewAt(BREW_SEARCH_PATHS[0]);

      await updateCliWithBrew();

      expect(mockRunProcessWithLifetime).toHaveBeenCalledWith(
        "/bin/bash",
        ["-c", "supervisor", "airpods-control-brew-supervisor", BREW_SEARCH_PATHS[0], "upgrade", CLI_BREW_FORMULA],
        expect.anything(),
      );
    });

    it("preserves multiline Homebrew recovery instructions", async () => {
      mockBrewAt(BREW_SEARCH_PATHS[0]);
      mockProcessResult({ exitCode: 1, stderr: "==> Fetching raulgg/tap\nError: some formula problem\n" });

      await expect(installCliWithBrew()).rejects.toThrow("==> Fetching raulgg/tap\nError: some formula problem");
    });

    it("should reject with the exec error message when stderr is empty", async () => {
      mockBrewAt(BREW_SEARCH_PATHS[0]);
      mockProcessResult({ exitCode: 1 });

      await expect(installCliWithBrew()).rejects.toThrow("Homebrew install failed");
    });

    it("should reject with a timeout message when brew is killed", async () => {
      mockBrewAt(BREW_SEARCH_PATHS[0]);
      mockProcessResult({ timedOut: true, exitCode: 137 });

      await expect(installCliWithBrew()).rejects.toThrow("timed out");
    });
  });
});

it("rejects directories at a Homebrew executable path", () => {
  mockBrewAt(BREW_SEARCH_PATHS[0]);
  vi.mocked(statSync).mockReturnValueOnce({ isFile: () => false } as ReturnType<typeof statSync>);
  expect(findBrewPath()).toBeNull();
});

it("does not query a prefix for an uninstalled formula", async () => {
  mockExecFileResult(null, "", "git\nother/tap/airpods-control\n");
  expect(await findBrewCliPrefix(BREW_SEARCH_PATHS[0])).toBeNull();
  expect(mockExecFile).toHaveBeenCalledTimes(1);
});

it("looks up the prefix of the installed formula from the correct tap", async () => {
  mockExecFile.mockImplementation((_file: string, args: string[], _options: unknown, callback: ExecCallback) => {
    callback(null, args[0] === "list" ? CLI_BREW_FORMULA + "\n" : "/opt/homebrew/opt/airpods-control\n", "");
  });
  expect(await findBrewCliPrefix(BREW_SEARCH_PATHS[0])).toBe("/opt/homebrew/opt/airpods-control");
});

it("preserves Homebrew errors when brew exits with the lock status", async () => {
  mockBrewAt(BREW_SEARCH_PATHS[0]);
  mockProcessResult({ exitCode: 75, stderr: "Homebrew reported a lock conflict" });
  await expect(installCliWithBrew()).rejects.toThrow("Homebrew reported a lock conflict");
});

it("explains lock contention before starting the installer", async () => {
  mockBrewAt(BREW_SEARCH_PATHS[0]);
  mockAcquireBrewLock.mockRejectedValue(Object.assign(new Error("lock busy"), { code: 75 }));

  await expect(installCliWithBrew()).rejects.toThrow("already running");
  expect(mockRunProcessWithLifetime).not.toHaveBeenCalled();
});
