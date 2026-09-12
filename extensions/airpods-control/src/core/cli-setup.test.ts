import { realpathSync } from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findBrewCliPrefix, findBrewPath } from "./brew";
import { isBrewOperationRunning } from "./brew-lock";
import { findCliPath, getConfiguredCliPath } from "./cli";
import { detectCliSetup } from "./cli-setup";
import { detectDeveloperTools } from "./developer-tools";

vi.mock("./brew-lock", () => ({ isBrewOperationRunning: vi.fn(async () => false) }));
vi.mock("fs", () => ({ realpathSync: vi.fn() }));
vi.mock("./brew", () => ({ findBrewCliPrefix: vi.fn(), findBrewPath: vi.fn() }));
vi.mock("./cli", () => ({ findCliPath: vi.fn(), getConfiguredCliPath: vi.fn() }));
vi.mock("./developer-tools", () => ({ detectDeveloperTools: vi.fn() }));

beforeEach(() => {
  vi.mocked(findCliPath).mockReturnValue(null);
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue(null);
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockImplementation((path) => String(path));
});

describe("CLI setup detection", () => {
  it("offers installation when Homebrew and tools are ready", async () => {
    expect((await detectCliSetup()).state).toBe("install");
  });
  it("routes missing Homebrew to setup", async () => {
    vi.mocked(findBrewPath).mockReturnValue(null);
    expect((await detectCliSetup()).state).toBe("needs-homebrew");
    expect(findBrewCliPrefix).not.toHaveBeenCalled();
  });
  it.each(["missing", "unavailable"] as const)("reports %s developer tools before trying brew", async (status) => {
    vi.mocked(detectDeveloperTools).mockResolvedValue(status);
    expect(await detectCliSetup()).toMatchObject({ state: "needs-developer-tools", developerTools: status });
    expect(findBrewCliPrefix).not.toHaveBeenCalled();
  });
  it("detects a Homebrew CLI through symlinks, including a configured path", async () => {
    vi.mocked(findCliPath).mockReturnValue("/custom/cli");
    vi.mocked(getConfiguredCliPath).mockReturnValue("/custom/cli");
    vi.mocked(findBrewCliPrefix).mockResolvedValue("/opt/homebrew/opt/airpods-control");
    vi.mocked(realpathSync).mockReturnValue("/opt/homebrew/Cellar/airpods-control/0.4.0/bin/airpods-control");
    expect((await detectCliSetup()).state).toBe("update");
  });
  it("does not upgrade a source CLI just because Homebrew is available", async () => {
    vi.mocked(findCliPath).mockReturnValue("/usr/local/bin/airpods-control");
    expect((await detectCliSetup()).state).toBe("manual-cli");
  });
  it("does not update an unrelated Homebrew CLI when a custom binary is active", async () => {
    vi.mocked(findCliPath).mockReturnValue("/custom/cli");
    vi.mocked(findBrewCliPrefix).mockResolvedValue("/opt/homebrew/opt/airpods-control");
    expect((await detectCliSetup()).state).toBe("manual-cli");
  });
  it("reports a stale custom path before offering any installation", async () => {
    vi.mocked(getConfiguredCliPath).mockReturnValue("/old/cli");
    expect((await detectCliSetup()).state).toBe("invalid-cli-path");
  });
  it("offers linking instructions when the formula exists but the CLI is missing", async () => {
    vi.mocked(findBrewCliPrefix).mockResolvedValue("/opt/homebrew/opt/airpods-control");
    expect((await detectCliSetup()).state).toBe("needs-link");
  });
  it("surfaces broken Homebrew instead of treating it as a missing formula", async () => {
    vi.mocked(findBrewCliPrefix).mockRejectedValueOnce(new Error("Homebrew permissions need repair"));
    await expect(detectCliSetup()).rejects.toThrow("permissions");
  });

  describe("Homebrew and developer-tool combinations", () => {
    it("shows developer-tool recovery when Homebrew and xcode-select are both missing", async () => {
      vi.mocked(findBrewPath).mockReturnValue(null);
      vi.mocked(detectDeveloperTools).mockResolvedValue("unavailable");

      await expect(detectCliSetup()).resolves.toMatchObject({
        state: "needs-developer-tools",
        brewPath: null,
        developerTools: "unavailable",
      });
      expect(findBrewCliPrefix).not.toHaveBeenCalled();
    });

    it("shows developer-tool recovery when Homebrew is installed but xcode-select is missing", async () => {
      vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
      vi.mocked(detectDeveloperTools).mockResolvedValue("unavailable");

      await expect(detectCliSetup()).resolves.toMatchObject({
        state: "needs-developer-tools",
        brewPath: "/opt/homebrew/bin/brew",
        developerTools: "unavailable",
      });
      expect(findBrewCliPrefix).not.toHaveBeenCalled();
    });

    it("shows Homebrew recovery when xcode-select is ready but Homebrew is missing", async () => {
      vi.mocked(findBrewPath).mockReturnValue(null);
      vi.mocked(detectDeveloperTools).mockResolvedValue("ready");

      await expect(detectCliSetup()).resolves.toMatchObject({
        state: "needs-homebrew",
        brewPath: null,
        developerTools: "ready",
      });
      expect(findBrewCliPrefix).not.toHaveBeenCalled();
    });
  });
});

it("reports an active install before checking prerequisites or querying Homebrew", async () => {
  vi.mocked(isBrewOperationRunning).mockResolvedValueOnce(true);
  expect((await detectCliSetup()).state).toBe("installing");
  expect(detectDeveloperTools).not.toHaveBeenCalled();
  expect(findBrewCliPrefix).not.toHaveBeenCalled();
});
