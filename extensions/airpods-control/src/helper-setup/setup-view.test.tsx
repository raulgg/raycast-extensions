/// <reference lib="dom" />
import { Clipboard, launchCommand } from "@raycast/api";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, vi, test } from "vitest";
import { cliSetup, deferred, installedCliSetup } from "../test/fixtures/cli-setup";
import Command from "../update-airpods-control-cli";
import {
  CLI_INSTALL_COMMAND,
  CLI_MANUAL_UPDATE_COMMAND,
  CLI_SOURCE_INSTALL_COMMAND,
  DEVELOPER_TOOLS_INSTALL_COMMAND,
  HOMEBREW_INSTALL_COMMAND,
} from "./constants";
import { detectCliSetup } from "./detection";
import { runCliInstallation } from "./installation";

vi.mock("./detection", () => ({ detectCliSetup: vi.fn() }));

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
    vi.restoreAllMocks();
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

test("does not offer prerequisite actions while detection is loading", async () => {
  // Given
  const view = createSetupView();
  const detection = deferred<ReturnType<typeof cliSetup>>();
  vi.mocked(detectCliSetup).mockReturnValue(detection.promise);
  // When
  await view.render();
  // Then
  expect(view.action("Open Homebrew Installation Instructions")).toBeNull();
  expect(view.action("Install with Homebrew")).toBeNull();
  expect(view.action("Refresh")).toBeNull();
  // When
  await act(async () => detection.resolve(cliSetup()));
  // Then
  expect(view.action("Install with Homebrew")).not.toBeNull();
});

test("guides Homebrew installation and copies the actual bootstrap command", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state: "needs-homebrew", brewPath: null }));
  // When
  await view.render();
  // Then
  expect(view.markdown()).toContain("Homebrew");
  expect(view.markdown()).toContain("Return here");
  // When
  await view.click("Copy Homebrew Install Command");
  // Then
  expect(Clipboard.copy).toHaveBeenCalledWith(HOMEBREW_INSTALL_COMMAND);
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

test("provides manual developer tools instructions and then allows installation after rechecking", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValueOnce(
    cliSetup({ state: "needs-developer-tools", developerTools: "missing" }),
  );
  // When
  await view.render();
  await view.click("Copy Developer Tools Install Command");
  // Then
  expect(Clipboard.copy).toHaveBeenCalledWith(DEVELOPER_TOOLS_INSTALL_COMMAND);
  expect(view.action("Install with Homebrew")).toBeNull();
  // When
  await view.click("Refresh");
  // Then
  expect(view.action("Install with Homebrew")).not.toBeNull();
});

test("links to Apple downloads when xcode-select itself is unavailable", async () => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(
    cliSetup({ state: "needs-developer-tools", developerTools: "unavailable" }),
  );
  // When
  await view.render();
  // Then
  expect(view.action("Copy Developer Tools Install Command")).toBeNull();
  expect(view.action("Open Apple Developer Downloads")).not.toBeNull();
  expect(view.markdown()).toContain("Apple Developer Downloads");
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
  const installation = deferred<ReturnType<typeof cliSetup>>();
  vi.mocked(runCliInstallation).mockReturnValue(installation.promise);
  // When
  await view.render();
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
  expect(view.markdown()).toContain("# Your helper is ready");
  expect(view.markdown()).toContain("You can now run your AirPods commands");
  expect(runCliInstallation).toHaveBeenCalledExactlyOnceWith("install");
  expect(launchCommand).not.toHaveBeenCalled();
});

test("ignores a late installation completion after leaving the view", async () => {
  // Given
  const view = createSetupView();
  const installation = deferred<ReturnType<typeof cliSetup>>();
  vi.mocked(runCliInstallation).mockReturnValue(installation.promise);
  // When
  await view.render();
  await view.click("Install with Homebrew");
  view.unmount();
  await act(async () => installation.resolve(installedCliSetup()));
  // Then
  expect(runCliInstallation).toHaveBeenCalledExactlyOnceWith("install");
});

test.each([
  ["install", "Install with Homebrew", "Copy Install Command", CLI_INSTALL_COMMAND],
  ["update", "Update with Homebrew", "Copy Update Command", CLI_MANUAL_UPDATE_COMMAND],
] as const)("offers direct %s before manual alternatives", async (state, title, copyTitle, command) => {
  // Given
  const view = createSetupView();
  vi.mocked(detectCliSetup).mockResolvedValue(state === "install" ? cliSetup() : installedCliSetup());
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
    expect(Clipboard.copy).toHaveBeenCalledWith(CLI_SOURCE_INSTALL_COMMAND);
  } else {
    expect(view.action("Open Tagged Installation Instructions")).toBeNull();
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
  expect(view.markdown()).toContain("# Your helper is ready");
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
  expect(actions).not.toContain("Open Tagged Installation Instructions");
  expect(actions.at(-1)).toBe("Refresh");
  if (state === "manual-cli") {
    expect(actions[0]).toBe("Open Update Instructions");
    expect(view.container.querySelector('[data-section-title="Alternative Methods"]')).toBeNull();
  }
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
