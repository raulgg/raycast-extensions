/// <reference lib="dom" />

import { Toast, showToast } from "@raycast/api";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installCliWithBrew } from "../core/brew";
import { findCliPath } from "../core/cli";
import Command from "../install-cli";
import { InstallCliView } from "./install-cli-view";

vi.mock("../core/brew", () => ({
  installCliWithBrew: vi.fn(),
}));

vi.mock("../core/cli", () => ({
  findCliPath: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockInstallCliWithBrew = vi.mocked(installCliWithBrew);
const mockFindCliPath = vi.mocked(findCliPath);
const mockShowToast = vi.mocked(showToast);

function makeToast() {
  return {
    style: Toast.Style.Animated,
    title: "Installing airpods-control…",
    message: "Running brew install; this can take a few minutes",
  } as unknown as Toast;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function actionButton(container: HTMLDivElement, title: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.dataset.actionTitle === title,
  );
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}

describe("InstallCliView", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInstallCliWithBrew.mockReset();
    mockInstallCliWithBrew.mockResolvedValue(undefined);
    mockFindCliPath.mockReset();
    mockFindCliPath.mockReturnValue(null);
    mockShowToast.mockReset();
    mockShowToast.mockResolvedValue(makeToast());
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function renderView(onRetry = vi.fn()) {
    root = createRoot(container);
    act(() => {
      root?.render(
        <StrictMode>
          <InstallCliView onRetry={onRetry} />
        </StrictMode>,
      );
    });
    return onRetry;
  }

  it("shows the setup requirements and retains the explicit install action", () => {
    renderView();

    expect(container.querySelector('[data-testid="markdown"]')?.textContent).toContain("Command Line Tools");
    expect(container.querySelector('[data-testid="markdown"]')?.textContent).toContain(
      "clear that preference to restore automatic detection",
    );
    expect(actionButton(container, "Install with Homebrew")).toBeDefined();
  });

  it("updates the toast and retries detection after a successful install", async () => {
    const toast = makeToast();
    mockShowToast.mockResolvedValue(toast);
    const onRetry = renderView();

    await act(async () => {
      actionButton(container, "Install with Homebrew").click();
      await flushPromises();
    });

    expect(mockInstallCliWithBrew).toHaveBeenCalledOnce();
    expect(toast.style).toBe(Toast.Style.Success);
    expect(toast.title).toBe("airpods-control installed");
    expect(toast.message).toBeUndefined();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="detail"]')?.getAttribute("data-loading")).toBe("false");
  });

  it("reports brew failures and can retry the install", async () => {
    const toast = makeToast();
    const error = new Error("brew failed");
    mockShowToast.mockResolvedValue(toast);
    mockInstallCliWithBrew.mockRejectedValue(error);
    const onRetry = renderView();

    await act(async () => {
      actionButton(container, "Install with Homebrew").click();
      await flushPromises();
    });

    expect(toast.style).toBe(Toast.Style.Failure);
    expect(toast.title).toBe("Install failed");
    expect(toast.message).toBe("brew failed");
    expect(onRetry).not.toHaveBeenCalled();

    const successToast = makeToast();
    mockShowToast.mockResolvedValue(successToast);
    mockInstallCliWithBrew.mockResolvedValue(undefined);
    await act(async () => {
      actionButton(container, "Install with Homebrew").click();
      await flushPromises();
    });

    expect(mockInstallCliWithBrew).toHaveBeenCalledTimes(2);
    expect(successToast.style).toBe(Toast.Style.Success);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="detail"]')?.getAttribute("data-loading")).toBe("false");
  });

  it("resets after the initial toast fails so installation can be retried", async () => {
    const toastError = new Error("toast unavailable");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockShowToast.mockRejectedValueOnce(toastError);
    const onRetry = renderView();

    await act(async () => {
      actionButton(container, "Install with Homebrew").click();
      await flushPromises();
    });

    expect(mockInstallCliWithBrew).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("Failed to show the CLI install toast", toastError);
    expect(container.querySelector('[data-testid="detail"]')?.getAttribute("data-loading")).toBe("false");

    const toast = makeToast();
    mockShowToast.mockResolvedValue(toast);
    await act(async () => {
      actionButton(container, "Install with Homebrew").click();
      await flushPromises();
    });

    expect(mockInstallCliWithBrew).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("ignores duplicate clicks before React rerenders", async () => {
    const install = deferred<void>();
    mockInstallCliWithBrew.mockReturnValue(install.promise);
    const onRetry = renderView();
    const button = actionButton(container, "Install with Homebrew");

    await act(async () => {
      button.click();
      button.click();
      await flushPromises();
    });

    expect(mockShowToast).toHaveBeenCalledOnce();
    expect(mockInstallCliWithBrew).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="detail"]')?.getAttribute("data-loading")).toBe("true");

    await act(async () => {
      install.resolve(undefined);
      await install.promise;
      await flushPromises();
    });

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("skips toast updates and retry callbacks after unmount", async () => {
    const install = deferred<void>();
    const toast = makeToast();
    mockShowToast.mockResolvedValue(toast);
    mockInstallCliWithBrew.mockReturnValue(install.promise);
    const onRetry = renderView();

    await act(async () => {
      actionButton(container, "Install with Homebrew").click();
      await flushPromises();
    });
    expect(mockInstallCliWithBrew).toHaveBeenCalledOnce();

    act(() => {
      root?.unmount();
      root = undefined;
    });
    await act(async () => {
      install.resolve(undefined);
      await install.promise;
      await flushPromises();
    });

    expect(toast.style).toBe(Toast.Style.Animated);
    expect(toast.title).toBe("Installing airpods-control…");
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("does not start brew when unmounted while the initial toast is pending", async () => {
    const toastShown = deferred<Toast>();
    const onRetry = renderView();
    mockShowToast.mockReturnValue(toastShown.promise);

    await act(async () => {
      actionButton(container, "Install with Homebrew").click();
      await flushPromises();
    });
    expect(mockShowToast).toHaveBeenCalledOnce();
    expect(mockInstallCliWithBrew).not.toHaveBeenCalled();

    act(() => {
      root?.unmount();
      root = undefined;
    });
    await act(async () => {
      toastShown.resolve(makeToast());
      await toastShown.promise;
      await flushPromises();
    });

    expect(mockInstallCliWithBrew).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe("install-cli command", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindCliPath.mockReset();
    mockFindCliPath.mockReturnValue("/opt/homebrew/bin/airpods-control");
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("describes executable detection without claiming every command is ready", () => {
    root = createRoot(container);
    act(() => {
      root?.render(
        <StrictMode>
          <Command />
        </StrictMode>,
      );
    });

    const markdown = container.querySelector('[data-testid="markdown"]')?.textContent;
    expect(markdown).toContain("CLI executable was detected");
    expect(markdown).toContain("Available commands still depend on your AirPods");
    expect(markdown).not.toContain("All AirPods commands of this extension are available");
  });
});
