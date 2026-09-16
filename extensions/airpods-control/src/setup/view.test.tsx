/// <reference lib="dom" />
import { Clipboard, launchCommand, open } from "@raycast/api";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, vi, test } from "vitest";
import { cliSetup, installedCliSetup, outdatedCliSetup } from "../test/fixtures/cli-setup";
import { deferred } from "../test/fixtures/deferred";
import Command from "../update-airpods-control-cli";
import { detectCliSetup } from "./detection";
import { runCliInstallation } from "./installation";
import type * as Detection from "./detection";

vi.mock("./detection", async (importOriginal) => {
  const actual = await importOriginal<typeof Detection>();
  return { ...actual, detectCliSetup: vi.fn() };
});

vi.mock("./installation", () => ({ runCliInstallation: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function createSetupView() {
  vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
  vi.mocked(runCliInstallation).mockReset().mockResolvedValue(installedCliSetup());
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let unmounted = false;
  function unmount() {
    if (!unmounted) act(() => root.unmount());
    unmounted = true;
  }
  onTestFinished(() => {
    unmount();
    container.remove();
  });
  async function render() {
    await act(async () => {
      root.render(<Command />);
    });
  }
  function action(title: string) {
    return container.querySelector<HTMLButtonElement>(`[data-action-title="${title}"]`);
  }
  async function click(title: string) {
    const button = action(title);
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
    });
  }
  function markdown() {
    return container.querySelector('[data-testid="markdown"]')?.textContent ?? "";
  }
  function actionGroups() {
    const panel = container.querySelector("[data-testid='action-panel']");
    if (!panel) return [];
    return Array.from(panel.children, (section) => ({
      title: section.getAttribute("data-section-title"),
      actions: Array.from(section.querySelectorAll("[data-action-title]"), (element) =>
        element.getAttribute("data-action-title"),
      ),
    })).filter((group) => group.actions.length > 0);
  }

  return { render, action, click, markdown, actionGroups, container, unmount };
}

const refresh = { title: null, actions: ["Refresh"] } as const;
const github = { title: null, actions: ["Open AirPods Control on GitHub"] } as const;
const statusActions = [github, refresh] as const;

test("guides Homebrew installation by opening the official instructions", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state: "needs-homebrew", brewPath: null }));
  // When
  await view.render();
  await view.click("Open Homebrew Installation Instructions");
  // Then
  expect(view.container.querySelector("[data-action-title]")?.getAttribute("data-action-title")).toBe(
    "Open Homebrew Installation Instructions",
  );
  expect(view.markdown()).toContain("https://brew.sh");
  expect(open).toHaveBeenCalledWith("https://brew.sh");
  expect(Clipboard.copy).not.toHaveBeenCalled();
  // When
  await view.click("Open AirPods Control on GitHub");
  // Then
  expect(open).toHaveBeenCalledWith("https://github.com/raulgg/airpods-control#airpods-control");
  expect(view.action("Install with Homebrew")).toBeNull();
  expect(view.action("Copy Source Install Command")).toBeNull();
});

test("moves from missing Homebrew to install after Refresh without automatically installing", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValueOnce(cliSetup({ state: "needs-homebrew", brewPath: null }));
  // When
  await view.render();
  await view.click("Refresh");
  // Then
  expect(view.action("Install with Homebrew")).not.toBeNull();
  expect(runCliInstallation).not.toHaveBeenCalled();
  expect(launchCommand).not.toHaveBeenCalled();
});

test("guides developer tools installation by opening Apple's official instructions", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValueOnce(
    cliSetup({ state: "needs-developer-tools", developerTools: "unavailable" }),
  );
  // When
  await view.render();
  await view.click("Open Apple's Installation Instructions");
  // Then
  expect(view.container.querySelector("[data-action-title]")?.getAttribute("data-action-title")).toBe(
    "Open Apple's Installation Instructions",
  );
  expect(view.markdown()).toContain(
    "https://developer.apple.com/documentation/xcode/installing-the-command-line-tools",
  );
  expect(view.markdown()).not.toContain("https://developer.apple.com/download/all/");
  expect(Clipboard.copy).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledWith(
    "https://developer.apple.com/documentation/xcode/installing-the-command-line-tools",
  );
  expect(view.action("Install with Homebrew")).toBeNull();
  expect(view.action("Open Installation Instructions")).toBeNull();
  // When
  await view.click("Refresh");
  // Then
  expect(view.action("Install with Homebrew")).not.toBeNull();
});

test.each(["installing", "manual-cli", "invalid-cli-path", "needs-link", "needs-reinstall"] as const)(
  "offers recovery instead of install or upgrade for %s",
  async (state) => {
    // Given
    const view = createSetupView();
    vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state }));
    // When
    await view.render();
    // Then
    expect(view.action("Install with Homebrew")).toBeNull();
    expect(view.action("Update with Homebrew")).toBeNull();
    expect(view.action("Refresh")).not.toBeNull();
  },
);

test("shows a persistent installing state, prevents duplicate actions, and then shows installation details", async () => {
  // Given
  const view = createSetupView();
  const detection = deferred<ReturnType<typeof cliSetup>>();
  vi.mocked(detectCliSetup).mockReturnValue(detection.promise);
  const installation = deferred<ReturnType<typeof cliSetup>>();
  vi.mocked(runCliInstallation).mockReturnValue(installation.promise);
  // When
  await view.render();
  // Then
  expect(view.action("Open Homebrew Installation Instructions")).toBeNull();
  expect(view.action("Install with Homebrew")).toBeNull();
  expect(view.action("Refresh")).toBeNull();
  expect(view.actionGroups()).toEqual([]);
  // When
  await act(async () => detection.resolve(cliSetup()));
  // Then
  const installAction = view.action("Install with Homebrew");
  const refreshAction = view.action("Refresh");
  expect(installAction).not.toBeNull();
  expect(refreshAction).not.toBeNull();
  // When
  await act(async () => {
    installAction?.click();
    refreshAction?.click();
    installAction?.click();
  });
  // Then
  expect(view.markdown()).toContain("# Installing CLI");
  expect(view.action("Install with Homebrew")).toBeNull();
  expect(view.action("Refresh")).toBeNull();
  expect(view.actionGroups()).toEqual([]);
  // When
  await act(async () => installation.resolve(installedCliSetup()));
  // Then
  expect(view.markdown()).toContain("# AirPods Control CLI is up to date");
  expect(view.markdown()).toContain("0.4.0");
  expect(view.markdown()).toContain("Homebrew");
  expect(view.markdown()).toContain("/opt/homebrew/bin/airpods-control");
  expect(view.markdown()).not.toContain("**Latest:**");
  expect(view.actionGroups()).toEqual(statusActions);
  expect(runCliInstallation).toHaveBeenCalledExactlyOnceWith("install");
  expect(launchCommand).not.toHaveBeenCalled();
});

test("keeps a new setup view independent of an installation started in a closed view", async () => {
  // Given
  const oldView = createSetupView();
  const installation = deferred<ReturnType<typeof cliSetup>>();
  vi.mocked(runCliInstallation).mockReturnValue(installation.promise);
  await oldView.render();
  // When
  await oldView.click("Install with Homebrew");
  oldView.unmount();
  const newView = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state: "needs-homebrew", brewPath: null }));
  await newView.render();
  // Then
  expect(newView.action("Open Homebrew Installation Instructions")).not.toBeNull();
  // When
  await act(async () => installation.resolve(installedCliSetup()));
  // Then
  expect(newView.action("Open Homebrew Installation Instructions")).not.toBeNull();
  expect(newView.action("Install with Homebrew")).toBeNull();
  expect(oldView.container.childElementCount).toBe(0);
  expect(launchCommand).not.toHaveBeenCalled();
});

test.each([
  ["install", "Install with Homebrew", "Copy Install Command", "brew install raulgg/tap/airpods-control"],
  ["update", "Update with Homebrew", "Copy Update Command", "brew update\nbrew upgrade raulgg/tap/airpods-control"],
] as const)("offers direct %s before manual alternatives", async (state, title, copyTitle, command) => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(state === "install" ? cliSetup() : outdatedCliSetup());
  // When
  await view.render();
  // Then
  expect(view.container.querySelector("[data-action-title]")?.getAttribute("data-action-title")).toBe(title);
  if (state === "install") {
    expect(view.markdown()).toContain("https://github.com/raulgg/airpods-control/blob/HEAD/README.md#install");
  } else {
    expect(view.markdown()).toContain("**Latest:**");
    expect(view.markdown()).toContain("Update with Homebrew");
  }
  // When
  await view.click(copyTitle);
  // Then
  expect(Clipboard.copy).toHaveBeenCalledWith(command);
  expect(runCliInstallation).not.toHaveBeenCalled();
  // When
  if (state === "install") {
    expect(view.action("Open Installation Instructions")).not.toBeNull();
  }
  expect(view.action("Copy Source Install Command")).toBeNull();
  const operation = deferred<ReturnType<typeof cliSetup>>();
  vi.mocked(runCliInstallation).mockReturnValue(operation.promise);
  await view.click(title);
  // Then
  expect(runCliInstallation).toHaveBeenCalledExactlyOnceWith(state);
  expect(view.action(title)).toBeNull();
  expect(view.action(copyTitle)).toBeNull();
  expect(view.markdown()).toContain(state === "install" ? "# Installing" : "# Updating");
  // When
  await act(async () => operation.resolve(installedCliSetup()));
  // Then
  expect(view.markdown()).toContain("# AirPods Control CLI is up to date");
  expect(view.markdown()).toContain("0.4.0");
  expect(view.markdown()).toContain("Homebrew");
  expect(view.markdown()).toContain("/opt/homebrew/bin/airpods-control");
  expect(view.markdown()).not.toContain("**Latest:**");
  expect(view.action("Open Installation Instructions")).toBeNull();
});

test.each([
  { name: "Homebrew has not linked the keg", brewLinked: false, command: "brew link raulgg/tap/airpods-control" },
  {
    name: "Homebrew already reports the keg as linked",
    brewLinked: true,
    command: "brew link --overwrite raulgg/tap/airpods-control",
  },
  { name: "the link status is unknown", brewLinked: null, command: "brew link raulgg/tap/airpods-control" },
] as const)("copies the link command that applies when $name", async ({ brewLinked, command }) => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(
    cliSetup({ state: "needs-link", brewCliPrefix: "/opt/homebrew/opt/airpods-control", brewLinked }),
  );
  // When
  await view.render();
  await view.click("Copy Link Command");
  // Then
  expect(Clipboard.copy).toHaveBeenCalledWith(command);
  expect(view.markdown()).toContain("/opt/homebrew/opt/airpods-control/bin/airpods-control");
  expect(view.action("Copy Reinstall Command")).toBeNull();
});

test("offers a reinstall when the Homebrew keg holds no usable CLI", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(
    cliSetup({ state: "needs-reinstall", brewCliPrefix: "/opt/homebrew/opt/airpods-control" }),
  );
  // When
  await view.render();
  await view.click("Copy Reinstall Command");
  // Then
  expect(Clipboard.copy).toHaveBeenCalledWith("brew reinstall raulgg/tap/airpods-control");
  expect(view.markdown()).toContain("/opt/homebrew/opt/airpods-control/bin/airpods-control");
  expect(view.action("Copy Link Command")).toBeNull();
});

test("keeps failure details visible until the user rechecks prerequisites", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(runCliInstallation).mockRejectedValueOnce(new Error("Homebrew needs repair\nRun brew doctor"));
  // When
  await view.render();
  await view.click("Install with Homebrew");
  // Then
  expect(view.markdown()).toContain("Run brew doctor");
  expect(view.action("Install with Homebrew")).toBeNull();
  expect(view.actionGroups()).toEqual([
    { title: null, actions: ["Copy Error"] },
    { title: null, actions: ["Open Installation Instructions", "Open AirPods Control on GitHub"] },
    refresh,
  ]);
  // When
  await view.click("Copy Error");
  // Then
  expect(Clipboard.copy).toHaveBeenCalledWith("Homebrew needs repair\nRun brew doctor");
  // When
  await view.click("Refresh");
  // Then
  expect(view.action("Install with Homebrew")).not.toBeNull();
});

test("offers retry and instructions after a detection error", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockRejectedValueOnce(new Error("brew permissions"));
  // When
  await view.render();
  // Then
  expect(view.markdown()).toContain("brew permissions");
  expect(view.actionGroups()).toEqual([
    { title: null, actions: ["Copy Error"] },
    { title: null, actions: ["Open Installation Instructions", "Open AirPods Control on GitHub"] },
    refresh,
  ]);
  // When
  await view.click("Refresh");
  // Then
  expect(view.action("Install with Homebrew")).not.toBeNull();
});

test.each([
  {
    name: "install",
    setup: cliSetup(),
    groups: [
      {
        title: null,
        actions: ["Install with Homebrew", "Copy Install Command"],
      },
      { title: null, actions: ["Open Installation Instructions", "Open AirPods Control on GitHub"] },
      refresh,
    ],
  },
  {
    name: "needs Homebrew",
    setup: cliSetup({ state: "needs-homebrew", brewPath: null }),
    groups: [
      { title: null, actions: ["Open Homebrew Installation Instructions", "Open AirPods Control on GitHub"] },
      refresh,
    ],
  },
  {
    name: "needs developer tools",
    setup: cliSetup({ state: "needs-developer-tools", developerTools: "unavailable" }),
    groups: [
      { title: null, actions: ["Open Apple's Installation Instructions", "Open AirPods Control on GitHub"] },
      refresh,
    ],
  },
  {
    name: "invalid CLI Path",
    setup: cliSetup({ state: "invalid-cli-path", configuredCliPath: "/old/cli" }),
    groups: [{ title: null, actions: ["Open Extension Preferences"] }, github, refresh],
  },
  {
    name: "needs Homebrew link",
    setup: cliSetup({ state: "needs-link" }),
    groups: [{ title: null, actions: ["Copy Link Command", "Open Extension Preferences"] }, github, refresh],
  },
  {
    name: "needs Homebrew reinstall",
    setup: cliSetup({ state: "needs-reinstall", brewCliPrefix: "/opt/homebrew/opt/airpods-control" }),
    groups: [{ title: null, actions: ["Copy Reinstall Command"] }, github, refresh],
  },
  {
    name: "setup already running",
    setup: cliSetup({ state: "installing" }),
    groups: statusActions,
  },
  {
    name: "Homebrew up to date",
    setup: installedCliSetup(),
    groups: statusActions,
  },
  {
    name: "Homebrew update available",
    setup: outdatedCliSetup(),
    groups: [
      { title: null, actions: ["Update with Homebrew", "Copy Update Command"] },
      { title: null, actions: ["Open Installation Instructions", "Open AirPods Control on GitHub"] },
      refresh,
    ],
  },
  {
    name: "manual up to date",
    setup: cliSetup({
      state: "manual-cli",
      cliPath: "/usr/local/bin/airpods-control",
      brewPath: null,
      installationMethod: "manual",
      installedVersion: "0.4.0",
      latestVersion: "0.4.0",
      latestSource: "github",
      versionStatus: "up-to-date",
      meetsMinimum: true,
    }),
    groups: statusActions,
  },
  {
    name: "manual update available",
    setup: cliSetup({
      state: "manual-cli",
      cliPath: "/usr/local/bin/airpods-control",
      brewPath: null,
      installationMethod: "manual",
      installedVersion: "0.4.0",
      latestVersion: "0.5.0",
      latestSource: "github",
      versionStatus: "update-available",
      meetsMinimum: true,
    }),
    groups: [
      { title: null, actions: ["Copy Source Install Command"] },
      { title: null, actions: ["Open Installation Instructions", "Open AirPods Control on GitHub"] },
      refresh,
    ],
  },
] as const)("uses untitled next-step, docs, and utility groups for $name", async ({ setup, groups }) => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(setup);
  // When
  await view.render();
  // Then
  expect(view.actionGroups()).toEqual(groups);
});

test("shows progress for an already-running Homebrew install and refreshes when it finishes", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup)
    .mockResolvedValueOnce(cliSetup({ state: "installing" }))
    .mockResolvedValue(installedCliSetup());
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  // When
  await view.render();
  // Then
  expect(view.container.querySelector("[data-testid='detail']")?.getAttribute("data-loading")).toBe("true");
  expect(view.actionGroups()).toEqual(statusActions);
  expect(detectCliSetup).toHaveBeenCalledOnce();
  // When
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  // Then
  expect(detectCliSetup).toHaveBeenCalledTimes(2);
  expect(view.container.querySelector("[data-testid='detail']")?.getAttribute("data-loading")).toBe("false");
  expect(view.actionGroups()).toEqual(statusActions);
});

test("hides Homebrew update actions when the helper is up to date", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
  // When
  await view.render();
  // Then
  expect(view.action("Update with Homebrew")).toBeNull();
  expect(view.action("Copy Update Command")).toBeNull();
  expect(view.action("Open Installation Instructions")).toBeNull();
  expect(view.action("Open Extension Preferences")).toBeNull();
  expect(view.markdown()).toContain("# AirPods Control CLI is up to date");
  expect(view.markdown()).toContain("0.4.0");
  expect(view.markdown()).toContain("Homebrew");
  expect(view.markdown()).not.toContain("**Latest:**");
  expect(view.actionGroups()).toEqual(statusActions);
});

test("hides manual update instructions when the helper is up to date", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(
    cliSetup({
      state: "manual-cli",
      cliPath: "/usr/local/bin/airpods-control",
      brewPath: null,
      installationMethod: "manual",
      installedVersion: "0.4.0",
      latestVersion: "0.4.0",
      latestSource: "github",
      versionStatus: "up-to-date",
      meetsMinimum: true,
    }),
  );
  // When
  await view.render();
  // Then
  expect(view.action("Open Installation Instructions")).toBeNull();
  expect(view.action("Open Homebrew Installation Instructions")).toBeNull();
  expect(view.action("Copy Source Install Command")).toBeNull();
  expect(view.action("Update with Homebrew")).toBeNull();
  expect(view.markdown()).toContain("# AirPods Control CLI is up to date");
  expect(view.markdown()).toContain("0.4.0");
  expect(view.markdown()).toContain("Manual");
  expect(view.markdown()).not.toContain("**Latest:**");
  expect(view.actionGroups()).toEqual(statusActions);
});

test("copies the source install command for a manual update without Homebrew help", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(
    cliSetup({
      state: "manual-cli",
      cliPath: "/usr/local/bin/airpods-control",
      brewPath: null,
      installationMethod: "manual",
      installedVersion: "0.4.0",
      latestVersion: "0.5.0",
      latestSource: "github",
      versionStatus: "update-available",
      meetsMinimum: true,
    }),
  );
  // When
  await view.render();
  await view.click("Copy Source Install Command");
  await view.click("Open Installation Instructions");
  // Then
  expect(Clipboard.copy).toHaveBeenCalledWith(
    [
      "tag=$(curl -fsSL -o /dev/null -w '%{url_effective}' https://github.com/raulgg/airpods-control/releases/latest)",
      "tag=${tag##*/}",
      "base=https://raw.githubusercontent.com/raulgg/airpods-control/$tag",
      'curl -fsSL "$base/scripts/install-from-source.sh" | sh -s -- --version "$tag"',
    ].join("\n"),
  );
  expect(open).toHaveBeenCalledWith("https://github.com/raulgg/airpods-control/blob/HEAD/README.md#install");
  expect(view.markdown()).toContain("https://github.com/raulgg/airpods-control/blob/HEAD/README.md#install");
  expect(view.markdown()).toContain("Refresh");
  expect(view.action("Open Homebrew Installation Instructions")).toBeNull();
  expect(view.action("Update with Homebrew")).toBeNull();
  expect(view.action("Copy Update Command")).toBeNull();
});

test("offers Homebrew update when the helper is below the minimum even if it matches the tap", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(
    installedCliSetup({
      installedVersion: "0.3.0",
      latestVersion: "0.3.0",
      versionStatus: "up-to-date",
      meetsMinimum: false,
    }),
  );
  // When
  await view.render();
  // Then
  expect(view.action("Update with Homebrew")).not.toBeNull();
  expect(view.action("Copy Update Command")).not.toBeNull();
  expect(view.markdown()).toContain("**Latest:**");
});

test("keeps Homebrew update available when the helper version is unknown", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(
    installedCliSetup({
      installedVersion: null,
      versionStatus: "unknown",
      meetsMinimum: null,
    }),
  );
  // When
  await view.render();
  // Then
  expect(view.action("Update with Homebrew")).not.toBeNull();
  expect(view.action("Copy Update Command")).not.toBeNull();
  expect(view.markdown()).toContain("**Latest:**");
});

test("does not navigate or start installation after leaving during detection", async () => {
  // Given
  const view = createSetupView();
  const detection = deferred<ReturnType<typeof cliSetup>>();
  vi.mocked(detectCliSetup).mockReturnValue(detection.promise);
  // When
  await view.render();
  view.unmount();
  await act(async () => detection.resolve(cliSetup()));
  // Then
  expect(runCliInstallation).not.toHaveBeenCalled();
  expect(launchCommand).not.toHaveBeenCalled();
});
