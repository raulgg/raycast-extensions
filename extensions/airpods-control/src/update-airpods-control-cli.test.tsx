/// <reference lib="dom" />
import { Clipboard, getPreferenceValues, launchCommand } from "@raycast/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCliInstallation } from "./core/cli-installation";
import { detectCliSetup } from "./core/cli-setup";
import { DEVELOPER_TOOLS_INSTALL_COMMAND, HOMEBREW_INSTALL_COMMAND } from "./core/consts";
import { cliSetup, deferred, installedCli } from "./test/cli-setup-fixture";
import Command from "./update-airpods-control-cli";

vi.mock("./core/cli-setup", () => ({ detectCliSetup: vi.fn() }));
vi.mock("./core/cli-installation", () => ({ runCliInstallation: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("CLI setup view", () => {
  let container: HTMLDivElement;
  let root: Root;
  let unmounted: boolean;
  beforeEach(() => {
    vi.mocked(getPreferenceValues).mockReturnValue({});
    vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
    vi.mocked(runCliInstallation).mockReset().mockResolvedValue(installedCli);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    unmounted = false;
  });
  afterEach(() => {
    if (!unmounted) act(() => root.unmount());
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

  it("does not offer prerequisite actions while detection is loading", async () => {
    const detection = deferred<ReturnType<typeof cliSetup>>();
    vi.mocked(detectCliSetup).mockReturnValue(detection.promise);
    await render();
    expect(action("Open Homebrew Installation Instructions")).toBeNull();
    expect(action("Install with Homebrew")).toBeNull();
    expect(action("Refresh Setup")).toBeNull();
    await act(async () => detection.resolve(cliSetup()));
    expect(action("Install with Homebrew")).not.toBeNull();
  });
  it("guides Homebrew installation and copies the actual bootstrap command", async () => {
    vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state: "needs-homebrew", brewPath: null }));
    await render();
    expect(markdown()).toContain("Install Homebrew first");
    expect(markdown()).toContain("Return here");
    await click("Copy Homebrew Install Command");
    expect(Clipboard.copy).toHaveBeenCalledWith(HOMEBREW_INSTALL_COMMAND);
    expect(action("Install with Homebrew")).toBeNull();
  });
  it("moves from missing Homebrew to install after Refresh Setup without automatically installing", async () => {
    vi.mocked(detectCliSetup).mockResolvedValueOnce(cliSetup({ state: "needs-homebrew", brewPath: null }));
    await render();
    await click("Refresh Setup");
    expect(action("Install with Homebrew")).not.toBeNull();
    expect(runCliInstallation).not.toHaveBeenCalled();
    expect(launchCommand).not.toHaveBeenCalled();
  });
  it("provides manual developer tools instructions and then allows installation after rechecking", async () => {
    vi.mocked(detectCliSetup).mockResolvedValueOnce(
      cliSetup({ state: "needs-developer-tools", developerTools: "missing" }),
    );
    await render();
    await click("Copy Developer Tools Install Command");
    expect(Clipboard.copy).toHaveBeenCalledWith(DEVELOPER_TOOLS_INSTALL_COMMAND);
    expect(action("Install with Homebrew")).toBeNull();
    await click("Refresh Setup");
    expect(action("Install with Homebrew")).not.toBeNull();
  });
  it("links to Apple downloads when xcode-select itself is unavailable", async () => {
    vi.mocked(detectCliSetup).mockResolvedValue(
      cliSetup({ state: "needs-developer-tools", developerTools: "unavailable" }),
    );
    await render();
    expect(action("Copy Developer Tools Install Command")).toBeNull();
    expect(action("Open Apple Developer Downloads")).not.toBeNull();
    expect(markdown()).toContain("xcode-select command is unavailable");
  });
  it.each(["installing", "manual-cli", "invalid-cli-path", "needs-link"] as const)(
    "offers recovery instead of install or upgrade for %s",
    async (state) => {
      vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state }));
      await render();
      expect(action("Install with Homebrew")).toBeNull();
      expect(action("Update with Homebrew")).toBeNull();
      expect(action("Refresh Setup")).not.toBeNull();
    },
  );
  it("shows a persistent installing state, prevents duplicate actions, and stays on success", async () => {
    const installation = deferred<ReturnType<typeof cliSetup>>();
    vi.mocked(runCliInstallation).mockReturnValue(installation.promise);
    await render();
    await click("Install with Homebrew");
    expect(markdown()).toContain("# Installing airpods-control CLI");
    expect(action("Install with Homebrew")).toBeNull();
    expect(action("Refresh Setup")).toBeNull();
    await act(async () => installation.resolve(installedCli));
    expect(markdown()).toContain("# AirPods Control CLI ready");
    expect(markdown()).toContain("Run your AirPods command again");
    expect(runCliInstallation).toHaveBeenCalledExactlyOnceWith("install");
    expect(launchCommand).not.toHaveBeenCalled();
  });
  it("uses the shared updater for a Homebrew-managed CLI", async () => {
    vi.mocked(detectCliSetup).mockResolvedValue(installedCli);
    await render();
    await click("Update with Homebrew");
    expect(runCliInstallation).toHaveBeenCalledWith("update");
  });
  it("keeps failure details visible until the user rechecks prerequisites", async () => {
    vi.mocked(runCliInstallation).mockRejectedValueOnce(new Error("Homebrew needs repair\nRun brew doctor"));
    await render();
    await click("Install with Homebrew");
    expect(markdown()).toContain("Run brew doctor");
    expect(action("Install with Homebrew")).toBeNull();
    await click("Copy Error");
    expect(Clipboard.copy).toHaveBeenCalledWith("Homebrew needs repair\nRun brew doctor");
    await click("Refresh Setup");
    expect(action("Install with Homebrew")).not.toBeNull();
  });
  it("offers retry and instructions after a detection error", async () => {
    vi.mocked(detectCliSetup).mockRejectedValueOnce(new Error("brew permissions"));
    await render();
    expect(markdown()).toContain("brew permissions");
    expect(action("Open CLI Installation Instructions")).not.toBeNull();
    await click("Refresh Setup");
    expect(action("Install with Homebrew")).not.toBeNull();
  });
  it("passes the testing preference to detection without changing the command guard", async () => {
    vi.mocked(getPreferenceValues).mockReturnValue({ simulateHomebrewUnavailable: true });
    await render();
    expect(detectCliSetup).toHaveBeenCalledWith({ simulateHomebrewUnavailable: true });
  });
  it("does not navigate or start installation after leaving during detection", async () => {
    const detection = deferred<ReturnType<typeof cliSetup>>();
    vi.mocked(detectCliSetup).mockReturnValue(detection.promise);
    await render();
    act(() => root.unmount());
    unmounted = true;
    await act(async () => detection.resolve(cliSetup()));
    expect(runCliInstallation).not.toHaveBeenCalled();
    expect(launchCommand).not.toHaveBeenCalled();
  });
});
