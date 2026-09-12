/// <reference lib="dom" />

import { showToast, Toast } from "@raycast/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findBrewPath, installCliWithBrew, updateCliWithBrew } from "./core/brew";
import { findCliPath } from "./core/cli";
import { runBrewOperationWithProgress } from "./core/cli-installation";
import { CLI_INSTALL_COMMAND } from "./core/consts";
import Command from "./update-airpods-control-cli";

vi.mock("./core/brew", () => ({
  findBrewPath: vi.fn(),
  installCliWithBrew: vi.fn(),
  updateCliWithBrew: vi.fn(),
}));

vi.mock("./core/cli", () => ({ findCliPath: vi.fn() }));

vi.mock("./core/cli-installation", () => ({
  runBrewOperationWithProgress: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockFindBrewPath = vi.mocked(findBrewPath);
const mockFindCliPath = vi.mocked(findCliPath);
const mockInstallCliWithBrew = vi.mocked(installCliWithBrew);
const mockUpdateCliWithBrew = vi.mocked(updateCliWithBrew);
const mockRunBrewOperationWithProgress = vi.mocked(runBrewOperationWithProgress);
const mockShowToast = vi.mocked(showToast);

function makeToast() {
  return {
    style: Toast.Style.Animated,
    title: "Updating airpods-control CLI…",
    message: "Homebrew can take several minutes. Keep Raycast open to see progress.",
    show: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
  } as unknown as Toast;
}

function actionButton(container: HTMLDivElement, title: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.dataset.actionTitle === title,
  );
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Update airpods-control CLI", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindBrewPath.mockReturnValue("/opt/homebrew/bin/brew");
    mockFindCliPath.mockReturnValue(null);
    mockInstallCliWithBrew.mockResolvedValue(undefined);
    mockUpdateCliWithBrew.mockResolvedValue(undefined);
    mockShowToast.mockResolvedValue(makeToast());
    mockRunBrewOperationWithProgress.mockImplementation(async (_toast, operation) => {
      await operation();
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    container.remove();
    vi.restoreAllMocks();
  });

  function render() {
    act(() => {
      root?.render(<Command />);
    });
  }

  it("explains how to recover when Homebrew is missing", () => {
    mockFindBrewPath.mockReturnValue(null);
    render();

    expect(container.querySelector('[data-testid="markdown"]')?.textContent).toContain("Homebrew required");
    expect(actionButton(container, "Open Homebrew Website")).toBeDefined();
    expect(actionButton(container, "Copy Install Command")).toBeDefined();
    expect(container.querySelector('[data-action-title="Install with Homebrew"]')).toBeNull();
  });

  it("offers installation when Homebrew exists but the CLI is missing", () => {
    render();

    const markdown = container.querySelector('[data-testid="markdown"]')?.textContent ?? "";
    expect(markdown).toContain("Install airpods-control CLI");
    expect(markdown).not.toContain("Homebrew is ready");
    expect(markdown).toContain("Install the CLI with Homebrew:");
    expect(markdown).toContain("If Homebrew reports that the Command Line Tools are missing, run:");
    expect(markdown).toContain("xcode-select --install");
    expect(markdown).toContain("When installation finishes, choose **Retry Detection** below.");
    expect(markdown.indexOf(CLI_INSTALL_COMMAND)).toBeLessThan(markdown.indexOf("xcode-select --install"));
    expect(actionButton(container, "Install with Homebrew")).toBeDefined();
    expect(actionButton(container, "Copy Install Command")).toBeDefined();
  });

  it("uses the same installation title with and without Homebrew", () => {
    mockFindBrewPath.mockReturnValue(null);
    render();
    const withoutHomebrew = container.querySelector('[data-testid="markdown"]')?.textContent;

    act(() => {
      root?.unmount();
      root = createRoot(container);
    });

    mockFindBrewPath.mockReturnValue("/opt/homebrew/bin/brew");
    render();
    const withHomebrew = container.querySelector('[data-testid="markdown"]')?.textContent;

    expect(withoutHomebrew?.split("\n")[1]).toBe("# Install airpods-control CLI");
    expect(withHomebrew?.split("\n")[1]).toBe("# Install airpods-control CLI");
  });

  it("offers an update and copies the upgrade command when the CLI is detected", () => {
    mockFindCliPath.mockReturnValue("/opt/homebrew/bin/airpods-control");
    render();

    expect(container.querySelector('[data-testid="markdown"]')?.textContent).toContain("CLI detected");
    expect(actionButton(container, "Update with Homebrew")).toBeDefined();
    expect(actionButton(container, "Copy Update Command")).toBeDefined();
    expect(container.querySelector('[data-action-title="Install with Homebrew"]')).toBeNull();
  });

  it("installs without running an AirPods action and asks the user to run it again", async () => {
    let cliPath: string | null = null;
    mockFindCliPath.mockImplementation(() => cliPath);
    mockInstallCliWithBrew.mockImplementation(async () => {
      cliPath = "/opt/homebrew/bin/airpods-control";
    });
    render();

    await act(async () => {
      actionButton(container, "Install with Homebrew").click();
      await flushPromises();
    });

    expect(mockInstallCliWithBrew).toHaveBeenCalledOnce();
    expect(mockUpdateCliWithBrew).not.toHaveBeenCalled();
    expect(mockRunBrewOperationWithProgress).toHaveBeenCalledOnce();
    const toast = await mockShowToast.mock.results[0].value;
    expect(toast.style).toBe(Toast.Style.Success);
    expect(toast.title).toBe("airpods-control CLI installed");
    expect(toast.message).toBe("Run your AirPods command again to use it.");
    expect(container.querySelector('[data-testid="markdown"]')?.textContent).toContain("CLI detected");
  });

  it("updates a detected CLI through Homebrew", async () => {
    mockFindCliPath.mockReturnValue("/opt/homebrew/bin/airpods-control");
    render();

    await act(async () => {
      actionButton(container, "Update with Homebrew").click();
      await flushPromises();
    });

    expect(mockUpdateCliWithBrew).toHaveBeenCalledOnce();
    expect(mockInstallCliWithBrew).not.toHaveBeenCalled();
    const toast = await mockShowToast.mock.results[0].value;
    expect(toast.style).toBe(Toast.Style.Success);
    expect(toast.title).toBe("airpods-control CLI updated");
    expect(toast.message).toBe("Run your AirPods command again to use it.");
  });

  it("prevents duplicate update actions while Homebrew is running", async () => {
    mockFindCliPath.mockReturnValue("/opt/homebrew/bin/airpods-control");
    let resolveOperation!: () => void;
    mockRunBrewOperationWithProgress.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveOperation = resolve;
      }),
    );
    render();
    const button = actionButton(container, "Update with Homebrew");

    await act(async () => {
      button.click();
      button.click();
      await flushPromises();
    });
    expect(mockShowToast).toHaveBeenCalledOnce();
    expect(mockRunBrewOperationWithProgress).toHaveBeenCalledOnce();
    expect(mockUpdateCliWithBrew).not.toHaveBeenCalled();

    await act(async () => {
      resolveOperation();
      await flushPromises();
    });
    expect(mockRunBrewOperationWithProgress).toHaveBeenCalledOnce();
  });

  it("reports Homebrew failures in the update toast", async () => {
    mockFindCliPath.mockReturnValue("/opt/homebrew/bin/airpods-control");
    const error = new Error("brew failed");
    mockRunBrewOperationWithProgress.mockRejectedValue(error);
    render();

    await act(async () => {
      actionButton(container, "Update with Homebrew").click();
      await flushPromises();
    });

    const toast = await mockShowToast.mock.results[0].value;
    expect(toast.style).toBe(Toast.Style.Failure);
    expect(toast.title).toBe("CLI update failed");
    expect(toast.message).toBe("brew failed");
  });
});
