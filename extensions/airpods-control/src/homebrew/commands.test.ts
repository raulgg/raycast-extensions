import { execFile } from "child_process";
import { accessSync, statSync } from "fs";
import { expect, vi, type Mock, test } from "vitest";
import { findBrewCliPrefix, findBrewPath, installCliWithBrew, updateCliWithBrew } from "./commands";
import { BREW_SEARCH_PATHS, CLI_BREW_FORMULA } from "./constants";
import { acquireBrewLock } from "./lock";
import { runProcessWithLifetime, type ProcessLifetimeResult } from "./process-lifetime";

vi.mock("./lock", () => ({
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

test("return the Apple Silicon path when brew is there", () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt(BREW_SEARCH_PATHS[0]);
  // When
  const result = findBrewPath();
  // Then
  expect(result).toBe(BREW_SEARCH_PATHS[0]);
});

test("fall back to the Intel path", () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt(BREW_SEARCH_PATHS[1]);
  // When
  const result = findBrewPath();
  // Then
  expect(result).toBe(BREW_SEARCH_PATHS[1]);
});

test("return null when brew is nowhere to be found", () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  // When
  const result = findBrewPath();
  // Then
  expect(result).toBeNull();
});

test("reject with a brew.sh hint when Homebrew is missing", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  // When
  const result = installCliWithBrew();
  // Then
  await expect(result).rejects.toThrow(/brew\.sh/);
  expect(mockExecFile).not.toHaveBeenCalled();
});

test("run brew install with the CLI formula", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt(BREW_SEARCH_PATHS[0]);
  // When
  await installCliWithBrew();
  // Then
  expect(mockRunProcessWithLifetime).toHaveBeenCalledWith(
    "/bin/bash",
    ["-c", "supervisor", "airpods-control-brew-supervisor", BREW_SEARCH_PATHS[0], "install", CLI_BREW_FORMULA],
    expect.anything(),
  );
});

test("run brew upgrade with the CLI formula", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt(BREW_SEARCH_PATHS[0]);
  // When
  await updateCliWithBrew();
  // Then
  expect(mockRunProcessWithLifetime).toHaveBeenCalledWith(
    "/bin/bash",
    ["-c", "supervisor", "airpods-control-brew-supervisor", BREW_SEARCH_PATHS[0], "upgrade", CLI_BREW_FORMULA],
    expect.anything(),
  );
});

test("preserves multiline Homebrew recovery instructions", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt(BREW_SEARCH_PATHS[0]);
  mockProcessResult({ exitCode: 1, stderr: "==> Fetching raulgg/tap\nError: some formula problem\n" });
  // When
  const result = installCliWithBrew();
  // Then
  await expect(result).rejects.toThrow("==> Fetching raulgg/tap\nError: some formula problem");
});

test("reject with the exec error message when stderr is empty", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt(BREW_SEARCH_PATHS[0]);
  mockProcessResult({ exitCode: 1 });
  // When
  const result = installCliWithBrew();
  // Then
  await expect(result).rejects.toThrow("Homebrew install failed");
});

test("reject with a timeout message when brew is killed", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt(BREW_SEARCH_PATHS[0]);
  mockProcessResult({ timedOut: true, exitCode: 137 });
  // When
  const result = installCliWithBrew();
  // Then
  await expect(result).rejects.toThrow("timed out");
});

test("rejects directories at a Homebrew executable path", () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt(BREW_SEARCH_PATHS[0]);
  vi.mocked(statSync).mockReturnValueOnce({ isFile: () => false } as ReturnType<typeof statSync>);
  // When
  const result = findBrewPath();
  // Then
  expect(result).toBeNull();
});

test("does not query a prefix for an uninstalled formula", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockExecFileResult(null, "", "git\nother/tap/airpods-control\n");
  // When
  const result = await findBrewCliPrefix(BREW_SEARCH_PATHS[0]);
  // Then
  expect(result).toBeNull();
  expect(mockExecFile).toHaveBeenCalledTimes(1);
});

test("looks up the prefix of the installed formula from the correct tap", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockExecFile.mockImplementation((_file: string, args: string[], _options: unknown, callback: ExecCallback) => {
    callback(null, args[0] === "list" ? CLI_BREW_FORMULA + "\n" : "/opt/homebrew/opt/airpods-control\n", "");
  });
  // When
  const result = await findBrewCliPrefix(BREW_SEARCH_PATHS[0]);
  // Then
  expect(result).toBe("/opt/homebrew/opt/airpods-control");
});

test("preserves Homebrew errors when brew exits with the lock status", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt(BREW_SEARCH_PATHS[0]);
  mockProcessResult({ exitCode: 75, stderr: "Homebrew reported a lock conflict" });
  // When
  const result = installCliWithBrew();
  // Then
  await expect(result).rejects.toThrow("Homebrew reported a lock conflict");
});

test("explains lock contention before starting the installer", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt(BREW_SEARCH_PATHS[0]);
  mockAcquireBrewLock.mockRejectedValue(Object.assign(new Error("lock busy"), { code: 75 }));
  // When
  const result = installCliWithBrew();
  // Then
  await expect(result).rejects.toThrow("already running");
  expect(mockRunProcessWithLifetime).not.toHaveBeenCalled();
});
