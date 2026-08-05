import { execFile } from "child_process";
import { accessSync } from "fs";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { findBrewPath, installCliWithBrew } from "./brew";
import { BREW_SEARCH_PATHS, CLI_BREW_FORMULA } from "./consts";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("fs", () => ({
  accessSync: vi.fn(),
  constants: { X_OK: 1 },
}));

const mockExecFile = execFile as unknown as Mock;
const mockAccessSync = vi.mocked(accessSync);

type ExecCallback = (error: (Error & { killed?: boolean }) | null, stdout: string, stderr: string) => void;

function mockExecFileResult(error: (Error & { killed?: boolean }) | null, stderr = "") {
  mockExecFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: ExecCallback) => {
    callback(error, "", stderr);
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
        BREW_SEARCH_PATHS[0],
        ["install", CLI_BREW_FORMULA],
        expect.anything(),
        expect.any(Function),
      );
    });

    it("should reject with the last stderr line when brew fails", async () => {
      mockBrewAt(BREW_SEARCH_PATHS[0]);
      mockExecFileResult(new Error("Command failed"), "==> Fetching raulgg/tap\nError: some formula problem\n");

      await expect(installCliWithBrew()).rejects.toThrow("Error: some formula problem");
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
