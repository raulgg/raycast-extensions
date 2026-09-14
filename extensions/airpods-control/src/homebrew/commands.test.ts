import { execFile } from "child_process";
import { accessSync, statSync } from "fs";
import { expect, vi, type Mock, test } from "vitest";
import {
  findBrewCliPrefix,
  findBrewLatestVersion,
  findBrewPath,
  installCliWithBrew,
  updateCliWithBrew,
} from "./commands";
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

test("returns the Apple Silicon path when brew is there", () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt("/opt/homebrew/bin/brew", "/usr/local/bin/brew");
  // When
  const result = findBrewPath();
  // Then
  expect(result).toBe("/opt/homebrew/bin/brew");
});

test("falls back to the Intel path", () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt("/usr/local/bin/brew");
  // When
  const result = findBrewPath();
  // Then
  expect(result).toBe("/usr/local/bin/brew");
});

test("returns null when brew is nowhere to be found", () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  // When
  const result = findBrewPath();
  // Then
  expect(result).toBeNull();
});

test("rejects with a brew.sh hint when Homebrew is missing", async () => {
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

test("runs brew install with the CLI formula", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt("/opt/homebrew/bin/brew");
  // When
  await installCliWithBrew();
  // Then
  expect(mockRunProcessWithLifetime).toHaveBeenCalledWith(
    "/bin/bash",
    [
      "-c",
      "supervisor",
      "airpods-control-brew-supervisor",
      "/opt/homebrew/bin/brew",
      "install",
      "raulgg/tap/airpods-control",
    ],
    expect.anything(),
  );
});

test("runs brew upgrade with the CLI formula", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt("/opt/homebrew/bin/brew");
  // When
  await updateCliWithBrew();
  // Then
  expect(mockRunProcessWithLifetime).toHaveBeenCalledWith(
    "/bin/bash",
    [
      "-c",
      "supervisor",
      "airpods-control-brew-supervisor",
      "/opt/homebrew/bin/brew",
      "upgrade",
      "raulgg/tap/airpods-control",
    ],
    expect.anything(),
  );
});

test("preserves multiline Homebrew recovery instructions", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt("/opt/homebrew/bin/brew");
  mockProcessResult({ exitCode: 1, stderr: "==> Fetching raulgg/tap\nError: some formula problem\n" });
  // When
  const result = installCliWithBrew();
  // Then
  await expect(result).rejects.toThrow("==> Fetching raulgg/tap\nError: some formula problem");
});

test("rejects with the exec error message when stderr is empty", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt("/opt/homebrew/bin/brew");
  mockProcessResult({ exitCode: 1 });
  // When
  const result = installCliWithBrew();
  // Then
  await expect(result).rejects.toThrow("Homebrew install failed");
});

test("rejects with a timeout message when brew is killed", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt("/opt/homebrew/bin/brew");
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
  mockBrewAt("/opt/homebrew/bin/brew");
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
  const result = await findBrewCliPrefix("/opt/homebrew/bin/brew");
  // Then
  expect(result).toBeNull();
  expect(mockExecFile).toHaveBeenCalledTimes(1);
});

test("reads the tap stable version from brew info JSON", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockExecFileResult(
    null,
    "",
    JSON.stringify({
      formulae: [
        { full_name: "other/tap/airpods-control", versions: { stable: "9.9.9" } },
        { full_name: "raulgg/tap/airpods-control", versions: { stable: "0.4.0" } },
      ],
    }),
  );
  // When
  const result = await findBrewLatestVersion("/opt/homebrew/bin/brew");
  // Then
  expect(result).toBe("0.4.0");
  expect(mockExecFile).toHaveBeenCalledWith(
    "/opt/homebrew/bin/brew",
    ["info", "--json=v2", "raulgg/tap/airpods-control"],
    expect.anything(),
    expect.any(Function),
  );
});

test("returns null when brew info cannot run", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockExecFileResult(new Error("brew info failed"), "Error: failed");
  // When
  const result = findBrewLatestVersion("/opt/homebrew/bin/brew");
  // Then
  await expect(result).resolves.toBeNull();
});

test("returns null when brew info JSON has no stable version", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockExecFileResult(null, "", "{not json");
  // When
  const result = await findBrewLatestVersion("/opt/homebrew/bin/brew");
  // Then
  expect(result).toBeNull();
});

test("looks up the prefix of the installed formula from the correct tap", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockExecFile.mockImplementation((_file: string, args: string[], _options: unknown, callback: ExecCallback) => {
    callback(
      null,
      args[0] === "list" ? "raulgg/tap/airpods-control" + "\n" : "/opt/homebrew/opt/airpods-control\n",
      "",
    );
  });
  // When
  const result = await findBrewCliPrefix("/opt/homebrew/bin/brew");
  // Then
  expect(result).toBe("/opt/homebrew/opt/airpods-control");
});

test("preserves Homebrew errors when brew exits with the lock status", async () => {
  // Given
  mockBrewAt();
  mockAcquireBrewLock.mockResolvedValue(undefined);
  mockProcessResult();
  mockBrewAt("/opt/homebrew/bin/brew");
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
  mockBrewAt("/opt/homebrew/bin/brew");
  mockAcquireBrewLock.mockRejectedValue(Object.assign(new Error("lock busy"), { code: 75 }));
  // When
  const result = installCliWithBrew();
  // Then
  await expect(result).rejects.toThrow("already running");
  expect(mockRunProcessWithLifetime).not.toHaveBeenCalled();
});
