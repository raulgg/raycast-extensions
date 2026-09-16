import { realpathSync } from "fs";
import { expect, vi, test } from "vitest";
import { findBrewPrefixCli, findCliPath, getConfiguredCliPath } from "../cli/discovery";
import { readInstalledVersion } from "../cli/version";
import { findBrewCliPrefix, findBrewLatestVersion, findBrewLinkedKeg, findBrewPath } from "../homebrew/commands";
import { isBrewOperationRunning } from "../homebrew/lock";
import { detectCliSetup } from "./detection";
import { detectDeveloperTools } from "./developer-tools";
import { fetchLatestGithubRelease } from "./latest-release";
import type * as CliDiscovery from "../cli/discovery";
import type * as CliVersion from "../cli/version";

vi.mock("../homebrew/lock", () => ({ isBrewOperationRunning: vi.fn(async () => false) }));

vi.mock("fs", () => ({ realpathSync: vi.fn() }));

vi.mock("../homebrew/commands", () => ({
  findBrewCliPrefix: vi.fn(),
  findBrewLatestVersion: vi.fn(async () => null),
  findBrewLinkedKeg: vi.fn(async () => null),
  findBrewPath: vi.fn(),
}));

vi.mock("../cli/discovery", async (importOriginal) => {
  const actual = await importOriginal<typeof CliDiscovery>();
  return { ...actual, findBrewPrefixCli: vi.fn(), findCliPath: vi.fn(), getConfiguredCliPath: vi.fn() };
});

vi.mock("../cli/version", async (importOriginal) => {
  const actual = await importOriginal<typeof CliVersion>();
  return { ...actual, readInstalledVersion: vi.fn(async () => null) };
});

vi.mock("./latest-release", () => ({
  fetchLatestGithubRelease: vi.fn(async () => ({
    version: null,
    source: null,
    liveCheckFailed: true,
  })),
}));

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

test.each([
  { name: "an unlinked formula", linked: false },
  { name: "a formula Homebrew already reports as linked", linked: true },
  { name: "a link status Homebrew cannot report", linked: null },
] as const)("offers linking when the keg CLI exists behind $name", async ({ linked }) => {
  // Given
  vi.mocked(findCliPath).mockReturnValue(null);
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockImplementation((path) => String(path));
  vi.mocked(findBrewCliPrefix).mockResolvedValue("/opt/homebrew/opt/airpods-control");
  vi.mocked(findBrewPrefixCli).mockReturnValue("/opt/homebrew/opt/airpods-control/bin/airpods-control");
  vi.mocked(findBrewLinkedKeg).mockResolvedValue(linked);
  // When
  const result = await detectCliSetup();
  // Then
  expect(result).toMatchObject({ state: "needs-link", brewLinked: linked });
  expect(findBrewPrefixCli).toHaveBeenCalledWith("/opt/homebrew/opt/airpods-control");
});

test("asks for a reinstall when the Homebrew keg has no usable CLI", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue(null);
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockImplementation((path) => String(path));
  vi.mocked(findBrewCliPrefix).mockResolvedValue("/opt/homebrew/opt/airpods-control");
  vi.mocked(findBrewPrefixCli).mockReturnValue(null);
  // When
  const result = await detectCliSetup();
  // Then
  expect(result).toMatchObject({ state: "needs-reinstall", brewLinked: null });
  expect(findBrewLinkedKeg).not.toHaveBeenCalled();
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

test("does not query helper versions when the CLI still needs installation", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue(null);
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue(null);
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockImplementation((path) => String(path));
  // When
  await detectCliSetup();
  // Then
  expect(readInstalledVersion).not.toHaveBeenCalled();
  expect(findBrewLatestVersion).not.toHaveBeenCalled();
  expect(fetchLatestGithubRelease).not.toHaveBeenCalled();
  expect(findBrewLinkedKeg).not.toHaveBeenCalled();
});

test("reports a Homebrew helper as up to date when it matches the tap version", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue("/opt/homebrew/bin/airpods-control");
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue("/opt/homebrew/opt/airpods-control");
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockReturnValue("/opt/homebrew/Cellar/airpods-control/0.4.0/bin/airpods-control");
  vi.mocked(readInstalledVersion).mockResolvedValue("0.4.0");
  vi.mocked(findBrewLatestVersion).mockResolvedValue("0.4.0");
  // When
  const result = await detectCliSetup();
  // Then
  expect(result).toMatchObject({
    state: "update",
    installationMethod: "homebrew",
    installedVersion: "0.4.0",
    latestVersion: "0.4.0",
    latestSource: "homebrew",
    liveCheckFailed: false,
    versionStatus: "up-to-date",
    meetsMinimum: true,
  });
  expect(fetchLatestGithubRelease).not.toHaveBeenCalled();
  // A usable CLI needs no link diagnosis, so Homebrew is not asked for one.
  expect(findBrewLinkedKeg).not.toHaveBeenCalled();
});

test("reports a Homebrew helper update when the installed version is older than the tap", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue("/opt/homebrew/bin/airpods-control");
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue("/opt/homebrew/opt/airpods-control");
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockReturnValue("/opt/homebrew/Cellar/airpods-control/0.4.0/bin/airpods-control");
  vi.mocked(readInstalledVersion).mockResolvedValue("0.3.0");
  vi.mocked(findBrewLatestVersion).mockResolvedValue("0.4.0");
  // When
  const result = await detectCliSetup();
  // Then
  expect(result).toMatchObject({
    state: "update",
    installationMethod: "homebrew",
    installedVersion: "0.3.0",
    latestVersion: "0.4.0",
    latestSource: "homebrew",
    versionStatus: "update-available",
    meetsMinimum: false,
  });
});

test("leaves latest unknown when brew info fails for a Homebrew helper", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue("/opt/homebrew/bin/airpods-control");
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue("/opt/homebrew/opt/airpods-control");
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockReturnValue("/opt/homebrew/Cellar/airpods-control/0.4.0/bin/airpods-control");
  vi.mocked(readInstalledVersion).mockResolvedValue("0.4.0");
  vi.mocked(findBrewLatestVersion).mockResolvedValue(null);
  // When
  const result = await detectCliSetup();
  // Then
  expect(result).toMatchObject({
    state: "update",
    installedVersion: "0.4.0",
    latestVersion: null,
    latestSource: null,
    liveCheckFailed: true,
    versionStatus: "unknown",
    meetsMinimum: true,
  });
});

test("leaves latest unknown when the Homebrew latest check rejects", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue("/opt/homebrew/bin/airpods-control");
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue("/opt/homebrew/opt/airpods-control");
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockReturnValue("/opt/homebrew/Cellar/airpods-control/0.4.0/bin/airpods-control");
  vi.mocked(readInstalledVersion).mockResolvedValue("0.4.0");
  vi.mocked(findBrewLatestVersion).mockRejectedValue(new Error("brew info failed"));
  // When
  const result = await detectCliSetup();
  // Then
  expect(result).toMatchObject({
    state: "update",
    installedVersion: "0.4.0",
    latestVersion: null,
    latestSource: null,
    liveCheckFailed: true,
    versionStatus: "unknown",
    meetsMinimum: true,
  });
});

test("treats a stale tap that matches an old install as up to date and below the minimum", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue("/opt/homebrew/bin/airpods-control");
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue("/opt/homebrew/opt/airpods-control");
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockReturnValue("/opt/homebrew/Cellar/airpods-control/0.3.0/bin/airpods-control");
  vi.mocked(readInstalledVersion).mockResolvedValue("0.3.0");
  vi.mocked(findBrewLatestVersion).mockResolvedValue("0.3.0");
  // When
  const result = await detectCliSetup();
  // Then
  expect(result).toMatchObject({
    state: "update",
    installedVersion: "0.3.0",
    latestVersion: "0.3.0",
    latestSource: "homebrew",
    liveCheckFailed: false,
    versionStatus: "up-to-date",
    meetsMinimum: false,
  });
});

test("reports a manual helper as up to date when it matches the GitHub release", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue("/usr/local/bin/airpods-control");
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue(null);
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(readInstalledVersion).mockResolvedValue("0.4.0");
  vi.mocked(fetchLatestGithubRelease).mockResolvedValue({
    version: "0.4.0",
    source: "github",
    liveCheckFailed: false,
  });
  // When
  const result = await detectCliSetup();
  // Then
  expect(result).toMatchObject({
    state: "manual-cli",
    installationMethod: "manual",
    installedVersion: "0.4.0",
    latestVersion: "0.4.0",
    latestSource: "github",
    liveCheckFailed: false,
    versionStatus: "up-to-date",
    meetsMinimum: true,
  });
  expect(findBrewLatestVersion).not.toHaveBeenCalled();
});

test("reports a manual helper update when GitHub has a newer release", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue("/usr/local/bin/airpods-control");
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue(null);
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockImplementation((path) => String(path));
  vi.mocked(readInstalledVersion).mockResolvedValue("0.3.0");
  vi.mocked(fetchLatestGithubRelease).mockResolvedValue({
    version: "0.4.0",
    source: "github",
    liveCheckFailed: false,
  });
  // When
  const result = await detectCliSetup();
  // Then
  expect(result).toMatchObject({
    state: "manual-cli",
    installationMethod: "manual",
    installedVersion: "0.3.0",
    latestVersion: "0.4.0",
    latestSource: "github",
    versionStatus: "update-available",
    meetsMinimum: false,
  });
});

test("leaves latest unknown when the GitHub latest-release check fails", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue("/usr/local/bin/airpods-control");
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue(null);
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(readInstalledVersion).mockResolvedValue("0.4.0");
  vi.mocked(fetchLatestGithubRelease).mockResolvedValue({
    version: null,
    source: null,
    liveCheckFailed: true,
  });
  // When
  const result = await detectCliSetup();
  // Then
  expect(result).toMatchObject({
    state: "manual-cli",
    installedVersion: "0.4.0",
    latestVersion: null,
    latestSource: null,
    liveCheckFailed: true,
    versionStatus: "unknown",
    meetsMinimum: true,
  });
});

test("treats a helper newer than the live GitHub release as up to date", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue("/usr/local/bin/airpods-control");
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue(null);
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(readInstalledVersion).mockResolvedValue("0.5.0");
  vi.mocked(fetchLatestGithubRelease).mockResolvedValue({
    version: "0.4.0",
    source: "github",
    liveCheckFailed: false,
  });
  // When
  const result = await detectCliSetup();
  // Then
  expect(result).toMatchObject({
    state: "manual-cli",
    installedVersion: "0.5.0",
    latestVersion: "0.4.0",
    latestSource: "github",
    versionStatus: "up-to-date",
    meetsMinimum: true,
  });
});

test("keeps the Homebrew helper state when the version command fails", async () => {
  // Given
  vi.mocked(findCliPath).mockReturnValue("/opt/homebrew/bin/airpods-control");
  vi.mocked(getConfiguredCliPath).mockReturnValue(null);
  vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
  vi.mocked(findBrewCliPrefix).mockResolvedValue("/opt/homebrew/opt/airpods-control");
  vi.mocked(detectDeveloperTools).mockResolvedValue("ready");
  vi.mocked(realpathSync).mockReturnValue("/opt/homebrew/Cellar/airpods-control/0.4.0/bin/airpods-control");
  vi.mocked(readInstalledVersion).mockResolvedValue(null);
  vi.mocked(findBrewLatestVersion).mockResolvedValue("0.4.0");
  // When
  const result = await detectCliSetup();
  // Then
  expect(result).toMatchObject({
    state: "update",
    installationMethod: "homebrew",
    installedVersion: null,
    latestVersion: "0.4.0",
    latestSource: "homebrew",
    versionStatus: "unknown",
    meetsMinimum: null,
  });
});
