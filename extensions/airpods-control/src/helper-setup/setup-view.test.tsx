/// <reference lib="dom" />
import { Clipboard, launchCommand } from "@raycast/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cliSetup, deferred, installedCli } from "../test/cli-setup-fixture";
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

describe("CLI setup view", () => {
  let container: HTMLDivElement;
  let root: Root;
  let unmounted: boolean;
  beforeEach(() => {
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
    expect(action("Refresh")).toBeNull();
    await act(async () => detection.resolve(cliSetup()));
    expect(action("Install with Homebrew")).not.toBeNull();
  });
  it("guides Homebrew installation and copies the actual bootstrap command", async () => {
    vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state: "needs-homebrew", brewPath: null }));
    await render();
    expect(markdown()).toContain("Homebrew");
    expect(markdown()).toContain("Return here");
    await click("Copy Homebrew Install Command");
    expect(Clipboard.copy).toHaveBeenCalledWith(HOMEBREW_INSTALL_COMMAND);
    expect(action("Install with Homebrew")).toBeNull();
  });
  it("moves from missing Homebrew to install after Refresh without automatically installing", async () => {
    vi.mocked(detectCliSetup).mockResolvedValueOnce(cliSetup({ state: "needs-homebrew", brewPath: null }));
    await render();
    await click("Refresh");
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
    await click("Refresh");
    expect(action("Install with Homebrew")).not.toBeNull();
  });
  it("links to Apple downloads when xcode-select itself is unavailable", async () => {
    vi.mocked(detectCliSetup).mockResolvedValue(
      cliSetup({ state: "needs-developer-tools", developerTools: "unavailable" }),
    );
    await render();
    expect(action("Copy Developer Tools Install Command")).toBeNull();
    expect(action("Open Apple Developer Downloads")).not.toBeNull();
    expect(markdown()).toContain("Apple Developer Downloads");
  });
  it.each(["installing", "manual-cli", "invalid-cli-path", "needs-link"] as const)(
    "offers recovery instead of install or upgrade for %s",
    async (state) => {
      vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state }));
      await render();
      expect(action("Install with Homebrew")).toBeNull();
      expect(action("Update with Homebrew")).toBeNull();
      expect(action("Refresh")).not.toBeNull();
    },
  );
  it("shows a persistent installing state, prevents duplicate actions, and stays on success", async () => {
    const installation = deferred<ReturnType<typeof cliSetup>>();
    vi.mocked(runCliInstallation).mockReturnValue(installation.promise);
    await render();
    const installAction = action("Install with Homebrew");
    const refreshAction = action("Refresh");
    expect(installAction).not.toBeNull();
    expect(refreshAction).not.toBeNull();
    await act(async () => {
      installAction?.click();
      refreshAction?.click();
      installAction?.click();
    });
    expect(markdown()).toContain("# Installing helper");
    expect(action("Install with Homebrew")).toBeNull();
    expect(action("Refresh")).toBeNull();
    await act(async () => installation.resolve(installedCli));
    expect(markdown()).toContain("# Your helper is ready");
    expect(markdown()).toContain("You can now run your AirPods commands");
    expect(runCliInstallation).toHaveBeenCalledExactlyOnceWith("install");
    expect(launchCommand).not.toHaveBeenCalled();
  });

  it("ignores a late installation completion after leaving the view", async () => {
    const installation = deferred<ReturnType<typeof cliSetup>>();
    vi.mocked(runCliInstallation).mockReturnValue(installation.promise);
    await render();
    await click("Install with Homebrew");
    act(() => root.unmount());
    unmounted = true;

    await act(async () => installation.resolve(installedCli));
    expect(runCliInstallation).toHaveBeenCalledExactlyOnceWith("install");
  });
  it.each([
    ["install", "Install with Homebrew", "Copy Install Command", CLI_INSTALL_COMMAND],
    ["update", "Update with Homebrew", "Copy Update Command", CLI_MANUAL_UPDATE_COMMAND],
  ] as const)("offers direct %s before manual alternatives", async (state, title, copyTitle, command) => {
    vi.mocked(detectCliSetup).mockResolvedValue(state === "install" ? cliSetup() : installedCli);
    await render();
    expect(container.querySelector("[data-action-title]")?.getAttribute("data-action-title")).toBe(title);
    await click(copyTitle);
    expect(Clipboard.copy).toHaveBeenCalledWith(command);
    expect(runCliInstallation).not.toHaveBeenCalled();
    if (state === "install") {
      expect(action("Open Installation Instructions")).not.toBeNull();
      await click("Copy Source Install Command");
      expect(Clipboard.copy).toHaveBeenCalledWith(CLI_SOURCE_INSTALL_COMMAND);
    } else {
      expect(action("Open Tagged Installation Instructions")).toBeNull();
      expect(action("Copy Source Install Command")).toBeNull();
    }
    const operation = deferred<ReturnType<typeof cliSetup>>();
    vi.mocked(runCliInstallation).mockReturnValue(operation.promise);
    await click(title);
    expect(runCliInstallation).toHaveBeenCalledExactlyOnceWith(state);
    expect(action(title)).toBeNull();
    expect(action(copyTitle)).toBeNull();
    expect(markdown()).toContain(state === "install" ? "# Installing" : "# Updating");
    await act(async () => operation.resolve(installedCli));
    expect(markdown()).toContain("# Your helper is ready");
  });
  it("keeps failure details visible until the user rechecks prerequisites", async () => {
    vi.mocked(runCliInstallation).mockRejectedValueOnce(new Error("Homebrew needs repair\nRun brew doctor"));
    await render();
    await click("Install with Homebrew");
    expect(markdown()).toContain("Run brew doctor");
    expect(action("Install with Homebrew")).toBeNull();
    await click("Copy Error");
    expect(Clipboard.copy).toHaveBeenCalledWith("Homebrew needs repair\nRun brew doctor");
    await click("Refresh");
    expect(action("Install with Homebrew")).not.toBeNull();
  });
  it("offers retry and instructions after a detection error", async () => {
    vi.mocked(detectCliSetup).mockRejectedValueOnce(new Error("brew permissions"));
    await render();
    expect(markdown()).toContain("brew permissions");
    expect(action("Open Installation Instructions")).not.toBeNull();
    await click("Refresh");
    expect(action("Install with Homebrew")).not.toBeNull();
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
    vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state }));
    await render();
    const actions = Array.from(container.querySelectorAll("[data-action-title]"), (element) =>
      element.getAttribute("data-action-title"),
    );
    expect(
      actions.filter((title) => title === "Open Installation Instructions" || title === "Open Update Instructions"),
    ).toHaveLength(1);
    expect(actions).not.toContain("Open Tagged Installation Instructions");
    expect(actions.at(-1)).toBe("Refresh");
    if (state === "manual-cli") {
      expect(actions[0]).toBe("Open Update Instructions");
      expect(container.querySelector('[data-section-title="Alternative Methods"]')).toBeNull();
    }
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
