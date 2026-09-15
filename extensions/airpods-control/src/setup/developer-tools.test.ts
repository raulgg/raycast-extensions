import { execFile } from "child_process";
import { accessSync } from "fs";
import { expect, vi, test } from "vitest";
import { detectDeveloperTools } from "./developer-tools";

vi.mock("child_process", () => ({ execFile: vi.fn() }));

vi.mock("fs", () => ({ accessSync: vi.fn(), constants: { X_OK: 1 } }));

const exec = vi.mocked(execFile);

function mockXcodeSelectAvailable() {
  vi.mocked(accessSync).mockImplementation(() => undefined);
}

function mockXcodeSelectUnavailable() {
  vi.mocked(accessSync).mockImplementation(() => {
    throw new Error("ENOENT");
  });
}

test("accepts a working selected Swift toolchain, including full Xcode", async () => {
  // Given
  vi.mocked(accessSync).mockReset();
  mockXcodeSelectAvailable();
  exec.mockImplementation((_file, _args, _options, callback) => {
    if (typeof callback === "function") callback(null, "", "");
    return {} as ReturnType<typeof execFile>;
  });
  // When
  const result = await detectDeveloperTools();
  // Then
  expect(result).toBe("ready");
  expect(exec).toHaveBeenNthCalledWith(1, "/usr/bin/xcode-select", ["-p"], expect.anything(), expect.any(Function));
  expect(exec).toHaveBeenNthCalledWith(
    2,
    "/usr/bin/xcrun",
    ["swiftc", "--version"],
    expect.anything(),
    expect.any(Function),
  );
});

test("provides downloads recovery when xcode-select is absent", async () => {
  // Given
  vi.mocked(accessSync).mockReset();
  mockXcodeSelectAvailable();
  exec.mockImplementation((_file, _args, _options, callback) => {
    if (typeof callback === "function") callback(null, "", "");
    return {} as ReturnType<typeof execFile>;
  });
  mockXcodeSelectUnavailable();
  // When
  const result = await detectDeveloperTools();
  // Then
  expect(result).toBe("unavailable");
  expect(exec).not.toHaveBeenCalled();
});

test("does not invoke xcrun or open an installer without a selected toolchain", async () => {
  // Given
  vi.mocked(accessSync).mockReset();
  mockXcodeSelectAvailable();
  exec.mockImplementation((_file, _args, _options, callback) => {
    if (typeof callback === "function") callback(null, "", "");
    return {} as ReturnType<typeof execFile>;
  });
  exec.mockImplementationOnce((_file, _args, _options, callback) => {
    if (typeof callback === "function") callback(new Error("no developer directory"), "", "");
    return {} as ReturnType<typeof execFile>;
  });
  // When
  const result = await detectDeveloperTools();
  // Then
  expect(result).toBe("missing");
  expect(exec).toHaveBeenCalledTimes(1);
});

test("detects a broken Swift compiler even when xcode-select succeeds", async () => {
  // Given
  vi.mocked(accessSync).mockReset();
  mockXcodeSelectAvailable();
  exec.mockImplementation((_file, _args, _options, callback) => {
    if (typeof callback === "function") callback(null, "", "");
    return {} as ReturnType<typeof execFile>;
  });
  exec.mockImplementation((_file, _args, _options, callback) => {
    if (typeof callback === "function")
      callback(_file === "/usr/bin/xcrun" ? new Error("broken compiler") : null, "", "");
    return {} as ReturnType<typeof execFile>;
  });
  // When
  const result = await detectDeveloperTools();
  // Then
  expect(result).toBe("missing");
});

test("requires clang as well as Swift for the companion library", async () => {
  // Given
  vi.mocked(accessSync).mockReset();
  mockXcodeSelectAvailable();
  exec.mockImplementation((_file, _args, _options, callback) => {
    if (typeof callback === "function") callback(null, "", "");
    return {} as ReturnType<typeof execFile>;
  });
  exec.mockImplementation((_file, args, _options, callback) => {
    if (typeof callback === "function")
      callback(Array.isArray(args) && args[0] === "clang" ? new Error("missing clang") : null, "", "");
    return {} as ReturnType<typeof execFile>;
  });
  // When
  const result = await detectDeveloperTools();
  // Then
  expect(result).toBe("missing");
});
