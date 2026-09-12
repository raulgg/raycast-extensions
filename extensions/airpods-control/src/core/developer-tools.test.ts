import { execFile } from "child_process";
import { accessSync } from "fs";
import { beforeEach, expect, it, vi } from "vitest";
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

beforeEach(() => {
  vi.mocked(accessSync).mockReset();
  mockXcodeSelectAvailable();
  exec.mockImplementation((_file, _args, _options, callback) => {
    if (typeof callback === "function") callback(null, "", "");
    return {} as ReturnType<typeof execFile>;
  });
});

it("accepts a working selected Swift toolchain, including full Xcode", async () => {
  expect(await detectDeveloperTools()).toBe("ready");
  expect(exec).toHaveBeenNthCalledWith(1, "/usr/bin/xcode-select", ["-p"], expect.anything(), expect.any(Function));
  expect(exec).toHaveBeenNthCalledWith(
    2,
    "/usr/bin/xcrun",
    ["swiftc", "--version"],
    expect.anything(),
    expect.any(Function),
  );
});

it("provides downloads recovery when xcode-select is absent", async () => {
  mockXcodeSelectUnavailable();
  expect(await detectDeveloperTools()).toBe("unavailable");
  expect(exec).not.toHaveBeenCalled();
});

it("does not invoke xcrun or open an installer without a selected toolchain", async () => {
  exec.mockImplementationOnce((_file, _args, _options, callback) => {
    if (typeof callback === "function") callback(new Error("no developer directory"), "", "");
    return {} as ReturnType<typeof execFile>;
  });
  expect(await detectDeveloperTools()).toBe("missing");
  expect(exec).toHaveBeenCalledTimes(1);
});

it("detects a broken Swift compiler even when xcode-select succeeds", async () => {
  exec.mockImplementation((_file, _args, _options, callback) => {
    if (typeof callback === "function")
      callback(_file === "/usr/bin/xcrun" ? new Error("broken compiler") : null, "", "");
    return {} as ReturnType<typeof execFile>;
  });
  expect(await detectDeveloperTools()).toBe("missing");
});

it("requires clang as well as Swift for the companion library", async () => {
  exec.mockImplementation((_file, args, _options, callback) => {
    if (typeof callback === "function")
      callback(Array.isArray(args) && args[0] === "clang" ? new Error("missing clang") : null, "", "");
    return {} as ReturnType<typeof execFile>;
  });
  expect(await detectDeveloperTools()).toBe("missing");
});
