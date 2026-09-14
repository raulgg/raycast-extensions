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

  return { render, action, click, markdown, container, unmount };
}

test("guides Homebrew installation and copies the actual bootstrap command", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state: "needs-homebrew", brewPath: null }));
  // When
  await view.render();
  // Then
  // When
  await view.click("Copy Homebrew Install Command");
  await view.click("Open Homebrew Installation Instructions");
  // Then
  expect(open).toHaveBeenCalledWith("https://brew.sh");
  expect(Clipboard.copy).toHaveBeenCalledWith(
    '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
  );
  expect(view.action("Install with Homebrew")).toBeNull();
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

test("provides developer tools recovery and then allows installation after rechecking", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValueOnce(
    cliSetup({ state: "needs-developer-tools", developerTools: "unavailable" }),
  );
  // When
  await view.render();
  await view.click("Copy Developer Tools Install Command");
  await view.click("Open Apple Developer Downloads");
  // Then
  expect(Clipboard.copy).toHaveBeenCalledWith("xcode-select --install");
  expect(open).toHaveBeenCalledWith("https://developer.apple.com/download/all/");
  expect(view.action("Install with Homebrew")).toBeNull();
  // When
  await view.click("Refresh");
  // Then
  expect(view.action("Install with Homebrew")).not.toBeNull();
});

test.each(["installing", "manual-cli", "invalid-cli-path", "needs-link"] as const)(
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

test("shows a persistent installing state, prevents duplicate actions, and stays on success", async () => {
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
  expect(view.markdown()).toContain("# Installing helper");
  expect(view.action("Install with Homebrew")).toBeNull();
  expect(view.action("Refresh")).toBeNull();
  // When
  await act(async () => installation.resolve(installedCliSetup()));
  // Then
  expect(view.markdown()).toContain("# AirPods Control Helper is ready");
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
  expect(newView.action("Copy Homebrew Install Command")).not.toBeNull();
  // When
  await act(async () => installation.resolve(installedCliSetup()));
  // Then
  expect(newView.action("Copy Homebrew Install Command")).not.toBeNull();
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
  // When
  await view.click(copyTitle);
  // Then
  expect(Clipboard.copy).toHaveBeenCalledWith(command);
  expect(runCliInstallation).not.toHaveBeenCalled();
  // When
  if (state === "install") {
    expect(view.action("Open Installation Instructions")).not.toBeNull();
    await view.click("Copy Source Install Command");
    expect(Clipboard.copy).toHaveBeenCalledWith(
      [
        "tag=$(curl -fsSL -o /dev/null -w '%{url_effective}' https://github.com/raulgg/airpods-control/releases/latest)",
        "tag=${tag##*/}",
        "base=https://raw.githubusercontent.com/raulgg/airpods-control/$tag",
        'curl -fsSL "$base/scripts/install-from-source.sh" | sh -s -- --version "$tag"',
      ].join("\n"),
    );
  } else {
    expect(view.action("Copy Source Install Command")).toBeNull();
  }
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
  expect(view.markdown()).toContain("# AirPods Control Helper is ready");
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
  expect(view.action("Open Installation Instructions")).not.toBeNull();
  // When
  await view.click("Refresh");
  // Then
  expect(view.action("Install with Homebrew")).not.toBeNull();
});

test.each([
  "install",
  "update",
  "needs-homebrew",
  "manual-cli",
  "needs-link",
  "invalid-cli-path",
  "needs-developer-tools",
  "installing",
] as const)("offers one helper instructions link and puts Refresh last for %s", async (state) => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state }));
  // When
  await view.render();
  const actions = Array.from(view.container.querySelectorAll("[data-action-title]"), (element) =>
    element.getAttribute("data-action-title"),
  );
  // Then
  expect(
    actions.filter((title) => title === "Open Installation Instructions" || title === "Open Update Instructions"),
  ).toHaveLength(1);
  expect(actions.at(-1)).toBe("Refresh");
  if (state === "manual-cli") {
    expect(actions[0]).toBe("Open Update Instructions");
    expect(view.container.querySelector('[data-section-title="Alternative Methods"]')).toBeNull();
  }
});

test("hides Homebrew update actions when the helper is up to date", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
  // When
  await view.render();
  const actions = Array.from(view.container.querySelectorAll("[data-action-title]"), (element) =>
    element.getAttribute("data-action-title"),
  );
  // Then
  expect(view.action("Update with Homebrew")).toBeNull();
  expect(view.action("Copy Update Command")).toBeNull();
  expect(view.action("Open Update Instructions")).toBeNull();
  expect(view.action("Open Installation Instructions")).not.toBeNull();
  expect(view.markdown()).toContain("# AirPods Control Helper is Up to date");
  expect(view.markdown()).toContain("0.4.0");
  expect(view.markdown()).toContain("Homebrew");
  expect(view.markdown()).not.toContain("**Latest:**");
  expect(actions.at(-1)).toBe("Refresh");
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
  const actions = Array.from(view.container.querySelectorAll("[data-action-title]"), (element) =>
    element.getAttribute("data-action-title"),
  );
  // Then
  expect(view.action("Open Update Instructions")).toBeNull();
  expect(view.action("Open Installation Instructions")).not.toBeNull();
  expect(view.action("Update with Homebrew")).toBeNull();
  expect(view.markdown()).toContain("# AirPods Control Helper is up to date");
  expect(view.markdown()).toContain("0.4.0");
  expect(view.markdown()).toContain("Manual");
  expect(view.markdown()).not.toContain("**Latest:**");
  expect(actions.at(-1)).toBe("Refresh");
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
