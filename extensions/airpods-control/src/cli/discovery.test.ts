import { accessSync, statSync } from "fs";
import { getPreferenceValues } from "@raycast/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findCliPath, isCliInstalled } from "./discovery";
import { CLI_SEARCH_PATHS } from "./preferences";
import type * as Fs from "fs";

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  return {
    ...actual,
    accessSync: vi.fn(),
    statSync: vi.fn(),
    constants: { ...actual.constants, X_OK: 1 },
  };
});

const mockAccessSync = vi.mocked(accessSync);
const mockStatSync = vi.mocked(statSync);
const mockGetPreferenceValues = vi.mocked(getPreferenceValues);

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
});
