import { accessSync, statSync } from "fs";
import { getPreferenceValues } from "@raycast/api";
import { expect, vi, test } from "vitest";
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

test("return the Homebrew path when the binary is there", () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  // When
  const result = findCliPath();
  // Then
  expect(result).toBe(CLI_SEARCH_PATHS[0]);
});

test("fall back to the next search path", () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt(CLI_SEARCH_PATHS[1]);
  // When
  const result = findCliPath();
  // Then
  expect(result).toBe(CLI_SEARCH_PATHS[1]);
});

test("return null when the binary is nowhere to be found", () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  // When
  const result = findCliPath();
  // Then
  expect(result).toBeNull();
});

test("use the CLI Path preference when set", () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockGetPreferenceValues.mockReturnValue({ cliPath: "/custom/bin/airpods-control" } as never);
  mockInstalledAt("/custom/bin/airpods-control");
  // When
  const result = findCliPath();
  // Then
  expect(result).toBe("/custom/bin/airpods-control");
});

test("not fall back to default paths when the CLI Path preference is invalid", () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockGetPreferenceValues.mockReturnValue({ cliPath: "/custom/bin/airpods-control" } as never);
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  // When
  const result = findCliPath();
  // Then
  expect(result).toBeNull();
});

test("reject a CLI Path preference that points at a directory", () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockGetPreferenceValues.mockReturnValue({ cliPath: "/opt/homebrew/bin" } as never);
  mockInstalledAt("/opt/homebrew/bin");
  mockStatSync.mockReturnValue({ isFile: () => false } as never);
  // When
  const result = findCliPath();
  // Then
  expect(result).toBeNull();
});

test("ignore a whitespace-only CLI Path preference", () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockGetPreferenceValues.mockReturnValue({ cliPath: "   " } as never);
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  // When
  const result = findCliPath();
  // Then
  expect(result).toBe(CLI_SEARCH_PATHS[0]);
});

test("mirror findCliPath", () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  // When
  const result = isCliInstalled();
  // Then
  expect(result).toBe(false);
  mockInstalledAt(CLI_SEARCH_PATHS[0]);
  // When
  const result2 = isCliInstalled();
  // Then
  expect(result2).toBe(true);
});
