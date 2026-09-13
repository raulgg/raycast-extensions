/// <reference lib="dom" />
import { Clipboard, launchCommand } from "@raycast/api";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, onTestFinished, vi } from "vitest";
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

describe("CLI setup view", () => {
  it("does not offer prerequisite actions while detection is loading", async () => {
    const view = createSetupView();
    const detection = deferred<ReturnType<typeof cliSetup>>();
    vi.mocked(detectCliSetup).mockReturnValue(detection.promise);
    await view.render();
    expect(view.action("Open Homebrew Installation Instructions")).toBeNull();
    expect(view.action("Install with Homebrew")).toBeNull();
    expect(view.action("Refresh")).toBeNull();
    await act(async () => detection.resolve(cliSetup()));
    expect(view.action("Install with Homebrew")).not.toBeNull();
  });
  it("guides Homebrew installation and copies the actual bootstrap command", async () => {
    const view = createSetupView();
    vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state: "needs-homebrew", brewPath: null }));
    await view.render();
    expect(view.markdown()).toContain("Homebrew");
    expect(view.markdown()).toContain("Return here");
    await view.click("Copy Homebrew Install Command");
    expect(Clipboard.copy).toHaveBeenCalledWith(HOMEBREW_INSTALL_COMMAND);
    expect(view.action("Install with Homebrew")).toBeNull();
  });
  it("moves from missing Homebrew to install after Refresh without automatically installing", async () => {
    const view = createSetupView();
    vi.mocked(detectCliSetup).mockResolvedValueOnce(cliSetup({ state: "needs-homebrew", brewPath: null }));
    await view.render();
    await view.click("Refresh");
    expect(view.action("Install with Homebrew")).not.toBeNull();
    expect(runCliInstallation).not.toHaveBeenCalled();
    expect(launchCommand).not.toHaveBeenCalled();
  });
  it("provides manual developer tools instructions and then allows installation after rechecking", async () => {
    const view = createSetupView();
    vi.mocked(detectCliSetup).mockResolvedValueOnce(
      cliSetup({ state: "needs-developer-tools", developerTools: "missing" }),
    );
    await view.render();
    await view.click("Copy Developer Tools Install Command");
    expect(Clipboard.copy).toHaveBeenCalledWith(DEVELOPER_TOOLS_INSTALL_COMMAND);
    expect(view.action("Install with Homebrew")).toBeNull();
    await view.click("Refresh");
    expect(view.action("Install with Homebrew")).not.toBeNull();
  });
  it("links to Apple downloads when xcode-select itself is unavailable", async () => {
    const view = createSetupView();
    vi.mocked(detectCliSetup).mockResolvedValue(
      cliSetup({ state: "needs-developer-tools", developerTools: "unavailable" }),
    );
    await view.render();
    expect(view.action("Copy Developer Tools Install Command")).toBeNull();
    expect(view.action("Open Apple Developer Downloads")).not.toBeNull();
    expect(view.markdown()).toContain("Apple Developer Downloads");
  });
  it.each(["installing", "manual-cli", "invalid-cli-path", "needs-link"] as const)(
    "offers recovery instead of install or upgrade for %s",
    async (state) => {
      const view = createSetupView();
      vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state }));
      await view.render();
      expect(view.action("Install with Homebrew")).toBeNull();
      expect(view.action("Update with Homebrew")).toBeNull();
      expect(view.action("Refresh")).not.toBeNull();
    },
  );
  it("shows a persistent installing state, prevents duplicate actions, and stays on success", async () => {
    const view = createSetupView();
    const installation = deferred<ReturnType<typeof cliSetup>>();
    vi.mocked(runCliInstallation).mockReturnValue(installation.promise);
    await view.render();
    const installAction = view.action("Install with Homebrew");
    const refreshAction = view.action("Refresh");
    expect(installAction).not.toBeNull();
    expect(refreshAction).not.toBeNull();
    await act(async () => {
      installAction?.click();
      refreshAction?.click();
      installAction?.click();
    });
    expect(view.markdown()).toContain("# Installing helper");
    expect(view.action("Install with Homebrew")).toBeNull();
    expect(view.action("Refresh")).toBeNull();
    await act(async () => installation.resolve(installedCliSetup()));
    expect(view.markdown()).toContain("# Your helper is ready");
    expect(view.markdown()).toContain("You can now run your AirPods commands");
    expect(runCliInstallation).toHaveBeenCalledExactlyOnceWith("install");
    expect(launchCommand).not.toHaveBeenCalled();
  });

  it("ignores a late installation completion after leaving the view", async () => {
    const view = createSetupView();
    const installation = deferred<ReturnType<typeof cliSetup>>();
    vi.mocked(runCliInstallation).mockReturnValue(installation.promise);
    await view.render();
    await view.click("Install with Homebrew");
    view.unmount();

    await act(async () => installation.resolve(installedCliSetup()));
    expect(runCliInstallation).toHaveBeenCalledExactlyOnceWith("install");
  });
  it.each([
    ["install", "Install with Homebrew", "Copy Install Command", CLI_INSTALL_COMMAND],
    ["update", "Update with Homebrew", "Copy Update Command", CLI_MANUAL_UPDATE_COMMAND],
  ] as const)("offers direct %s before manual alternatives", async (state, title, copyTitle, command) => {
    const view = createSetupView();
    vi.mocked(detectCliSetup).mockResolvedValue(state === "install" ? cliSetup() : installedCliSetup());
    await view.render();
    expect(view.container.querySelector("[data-action-title]")?.getAttribute("data-action-title")).toBe(title);
    await view.click(copyTitle);
    expect(Clipboard.copy).toHaveBeenCalledWith(command);
    expect(runCliInstallation).not.toHaveBeenCalled();
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
    expect(runCliInstallation).toHaveBeenCalledExactlyOnceWith(state);
    expect(view.action(title)).toBeNull();
    expect(view.action(copyTitle)).toBeNull();
    expect(view.markdown()).toContain(state === "install" ? "# Installing" : "# Updating");
    await act(async () => operation.resolve(installedCliSetup()));
    expect(view.markdown()).toContain("# Your helper is ready");
  });
  it("keeps failure details visible until the user rechecks prerequisites", async () => {
    const view = createSetupView();
    vi.mocked(runCliInstallation).mockRejectedValueOnce(new Error("Homebrew needs repair\nRun brew doctor"));
    await view.render();
    await view.click("Install with Homebrew");
    expect(view.markdown()).toContain("Run brew doctor");
    expect(view.action("Install with Homebrew")).toBeNull();
    await view.click("Copy Error");
    expect(Clipboard.copy).toHaveBeenCalledWith("Homebrew needs repair\nRun brew doctor");
    await view.click("Refresh");
    expect(view.action("Install with Homebrew")).not.toBeNull();
  });
  it("offers retry and instructions after a detection error", async () => {
    const view = createSetupView();
    vi.mocked(detectCliSetup).mockRejectedValueOnce(new Error("brew permissions"));
    await view.render();
    expect(view.markdown()).toContain("brew permissions");
    expect(view.action("Open Installation Instructions")).not.toBeNull();
    await view.click("Refresh");
    expect(view.action("Install with Homebrew")).not.toBeNull();
  });
  it.each([
    "install",
    "update",
    "needs-homebrew",
    "manual-cli",
    "needs-link",
    "invalid-cli-path",
    "needs-developer-tools",
    "installing",
  ] as const)("offers one helper instructions link and puts Refresh last for %s", async (state) => {
    const view = createSetupView();
    vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state }));
    await view.render();
    const actions = Array.from(view.container.querySelectorAll("[data-action-title]"), (element) =>
      element.getAttribute("data-action-title"),
    );
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
  it("does not navigate or start installation after leaving during detection", async () => {
    const view = createSetupView();
    const detection = deferred<ReturnType<typeof cliSetup>>();
    vi.mocked(detectCliSetup).mockReturnValue(detection.promise);
    await view.render();
    view.unmount();
    await act(async () => detection.resolve(cliSetup()));
    expect(runCliInstallation).not.toHaveBeenCalled();
    expect(launchCommand).not.toHaveBeenCalled();
  });
});
