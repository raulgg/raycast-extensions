import { execFile } from "child_process";
import { accessSync, statSync } from "fs";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { findBrewCliPrefix, findBrewPath, installCliWithBrew, updateCliWithBrew } from "./brew";
import { BREW_SEARCH_PATHS, CLI_BREW_FORMULA } from "./consts";

vi.mock("./brew-lock", () => ({
  brewLockCommand: (file: string, args: string[]) => ({
    file: "/usr/bin/lockf",
    args: ["-k", "-s", "-t", "0", "/test/cli-install.lock", file, ...args],
  }),
}));
vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("fs", () => ({
  accessSync: vi.fn(),
  statSync: vi.fn(() => ({ isFile: () => true })),
  constants: { X_OK: 1 },
}));

const mockExecFile = execFile as unknown as Mock;
const mockAccessSync = vi.mocked(accessSync);

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

describe("brew", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrewAt();
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
      mockExecFileResult(null);

      await installCliWithBrew();

      expect(mockExecFile).toHaveBeenCalledWith(
        "/usr/bin/lockf",
        ["-k", "-s", "-t", "0", "/test/cli-install.lock", BREW_SEARCH_PATHS[0], "install", CLI_BREW_FORMULA],
        expect.anything(),
        expect.any(Function),
      );
    });

    it("should run brew upgrade with the CLI formula", async () => {
      mockBrewAt(BREW_SEARCH_PATHS[0]);
      mockExecFileResult(null);

      await updateCliWithBrew();

      expect(mockExecFile).toHaveBeenCalledWith(
        "/usr/bin/lockf",
        ["-k", "-s", "-t", "0", "/test/cli-install.lock", BREW_SEARCH_PATHS[0], "upgrade", CLI_BREW_FORMULA],
        expect.anything(),
        expect.any(Function),
      );
    });

    it("preserves multiline Homebrew recovery instructions", async () => {
      mockBrewAt(BREW_SEARCH_PATHS[0]);
      mockExecFileResult(new Error("Command failed"), "==> Fetching raulgg/tap\nError: some formula problem\n");

      await expect(installCliWithBrew()).rejects.toThrow("==> Fetching raulgg/tap\nError: some formula problem");
    });

    it("should reject with the exec error message when stderr is empty", async () => {
      mockBrewAt(BREW_SEARCH_PATHS[0]);
      mockExecFileResult(new Error("Command failed"), "");

      await expect(installCliWithBrew()).rejects.toThrow("Command failed");
    });

    it("should reject with a timeout message when brew is killed", async () => {
      mockBrewAt(BREW_SEARCH_PATHS[0]);
      const error = new Error("killed") as Error & { killed?: boolean };
      error.killed = true;
      mockExecFileResult(error);

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

it("explains lock contention without running a second installer", async () => {
  mockBrewAt(BREW_SEARCH_PATHS[0]);
  mockExecFileResult(Object.assign(new Error("locked"), { code: 75 }));
  await expect(installCliWithBrew()).rejects.toThrow("already running");
});
