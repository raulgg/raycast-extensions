import { accessSync, statSync } from "fs";
import { getPreferenceValues } from "@raycast/api";
import { expect, vi, test } from "vitest";
import { findCliPath, isCliInstalled } from "./discovery";
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

test("returns the Homebrew path when the binary is there", () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt("/opt/homebrew/bin/airpods-control", "/usr/local/bin/airpods-control");
  // When
  const result = findCliPath();
  // Then
  expect(result).toBe("/opt/homebrew/bin/airpods-control");
});

test("falls back to the next search path", () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockInstalledAt("/usr/local/bin/airpods-control");
  // When
  const result = findCliPath();
  // Then
  expect(result).toBe("/usr/local/bin/airpods-control");
});

test("returns null when the binary is nowhere to be found", () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  // When
  const result = findCliPath();
  // Then
  expect(result).toBeNull();
});

test("uses the CLI Path preference when set", () => {
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

test("does not fall back to default paths when the CLI Path preference is invalid", () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockGetPreferenceValues.mockReturnValue({ cliPath: "/custom/bin/airpods-control" } as never);
  mockInstalledAt("/opt/homebrew/bin/airpods-control");
  // When
  const result = findCliPath();
  // Then
  expect(result).toBeNull();
});

test("rejects a CLI Path preference that points at a directory", () => {
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

test("ignores a whitespace-only CLI Path preference", () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  mockGetPreferenceValues.mockReturnValue({ cliPath: "   " } as never);
  mockInstalledAt("/opt/homebrew/bin/airpods-control");
  // When
  const result = findCliPath();
  // Then
  expect(result).toBe("/opt/homebrew/bin/airpods-control");
});

test("mirrors findCliPath", () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt();
  // When
  const result = isCliInstalled();
  // Then
  expect(result).toBe(false);
  mockInstalledAt("/opt/homebrew/bin/airpods-control");
  // When
  const result2 = isCliInstalled();
  // Then
  expect(result2).toBe(true);
});
