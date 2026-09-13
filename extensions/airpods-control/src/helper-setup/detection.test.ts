import { realpathSync } from "fs";
import { expect, vi, test } from "vitest";
import { findCliPath, getConfiguredCliPath } from "../cli/discovery";
import { findBrewCliPrefix, findBrewPath } from "../homebrew/commands";
import { isBrewOperationRunning } from "../homebrew/lock";
import { detectCliSetup } from "./detection";
import { detectDeveloperTools } from "./developer-tools";

vi.mock("../homebrew/lock", () => ({ isBrewOperationRunning: vi.fn(async () => false) }));

vi.mock("fs", () => ({ realpathSync: vi.fn() }));

vi.mock("../homebrew/commands", () => ({ findBrewCliPrefix: vi.fn(), findBrewPath: vi.fn() }));

vi.mock("../cli/discovery", () => ({ findCliPath: vi.fn(), getConfiguredCliPath: vi.fn() }));

vi.mock("./developer-tools", () => ({ detectDeveloperTools: vi.fn() }));

test("offers installation when Homebrew and tools are ready", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue(null);
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue(null);
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockImplementation((path) => String(path));
  // When
  const result = (await detectCliSetup()).state;
  // Then
  expect(result).toBe("install");
});

test.each(["missing", "unavailable"] as const)("reports %s developer tools before trying brew", async (status) => {
  // Given
  vi.mocked(findCliPath).mockReturnValue(null);
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue(null);
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockImplementation((path) => String(path));
  vi.mocked(detectDeveloperTools).mockResolvedValue(status);
  // When
  const result = await detectCliSetup();
  // Then
  expect(result).toMatchObject({ state: "needs-developer-tools", developerTools: status });
  expect(findBrewCliPrefix).not.toHaveBeenCalled();
});

test("detects a Homebrew CLI through symlinks, including a configured path", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue(null);
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue(null);
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockImplementation((path) => String(path));
  vi.mocked(findCliPath).mockReturnValue("/custom/cli");
  vi.mocked(getConfiguredCliPath).mockReturnValue("/custom/cli");
  vi.mocked(findBrewCliPrefix).mockResolvedValue("/opt/homebrew/opt/airpods-control");
  vi.mocked(realpathSync).mockReturnValue("/opt/homebrew/Cellar/airpods-control/0.4.0/bin/airpods-control");
  // When
  const result = (await detectCliSetup()).state;
  // Then
  expect(result).toBe("update");
});

test("does not upgrade a source CLI just because Homebrew is available", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue(null);
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue(null);
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockImplementation((path) => String(path));
  vi.mocked(findCliPath).mockReturnValue("/usr/local/bin/airpods-control");
  // When
  const result = (await detectCliSetup()).state;
  // Then
  expect(result).toBe("manual-cli");
});

test("does not update an unrelated Homebrew CLI when a custom binary is active", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue(null);
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue(null);
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockImplementation((path) => String(path));
  vi.mocked(findCliPath).mockReturnValue("/custom/cli");
  vi.mocked(findBrewCliPrefix).mockResolvedValue("/opt/homebrew/opt/airpods-control");
  // When
  const result = (await detectCliSetup()).state;
  // Then
  expect(result).toBe("manual-cli");
});

test("reports a stale custom path before offering any installation", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue(null);
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue(null);
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockImplementation((path) => String(path));
  vi.mocked(getConfiguredCliPath).mockReturnValue("/old/cli");
  // When
  const result = (await detectCliSetup()).state;
  // Then
  expect(result).toBe("invalid-cli-path");
});

test("offers linking instructions when the formula exists but the CLI is missing", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue(null);
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue(null);
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockImplementation((path) => String(path));
  vi.mocked(findBrewCliPrefix).mockResolvedValue("/opt/homebrew/opt/airpods-control");
  // When
  const result = (await detectCliSetup()).state;
  // Then
  expect(result).toBe("needs-link");
});

test("surfaces broken Homebrew instead of treating it as a missing formula", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue(null);
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue(null);
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockImplementation((path) => String(path));
  vi.mocked(findBrewCliPrefix).mockRejectedValueOnce(new Error("Homebrew permissions need repair"));
  // When
  const result = detectCliSetup();
  // Then
  await expect(result).rejects.toThrow("permissions");
});

test.each([
  { name: "missing Homebrew and xcode-select", brewPath: null, tools: "unavailable", state: "needs-developer-tools" },
  {
    name: "Homebrew with missing xcode-select",
    brewPath: "/opt/homebrew/bin/brew",
    tools: "unavailable",
    state: "needs-developer-tools",
  },
  { name: "ready tools without Homebrew", brewPath: null, tools: "ready", state: "needs-homebrew" },
] as const)("prioritizes prerequisites for $name", async ({ brewPath, tools, state }) => {
  // Given
  vi.mocked(findCliPath).mockReturnValue(null);
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue(brewPath);
  vi.mocked(detectDeveloperTools).mockResolvedValue(tools);
  // When
  const setup = await detectCliSetup();
  // Then
  expect(setup).toMatchObject({ state, brewPath, developerTools: tools });
  expect(findBrewCliPrefix).not.toHaveBeenCalled();
});

test("reports an active install before checking prerequisites or querying Homebrew", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue(null);
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue(null);
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockImplementation((path) => String(path));
  vi.mocked(isBrewOperationRunning).mockResolvedValueOnce(true);
  // When
  const result = (await detectCliSetup()).state;
  // Then
  expect(result).toBe("installing");
  expect(detectDeveloperTools).not.toHaveBeenCalled();
  expect(findBrewCliPrefix).not.toHaveBeenCalled();
});
