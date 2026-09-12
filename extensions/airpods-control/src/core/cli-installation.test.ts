import { Clipboard, confirmAlert, open, openExtensionPreferences, showToast, Toast } from "@raycast/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findBrewPath, installCliWithBrew } from "./brew";
import { isCliInstalled } from "./cli";
import { promptForCliInstallation } from "./cli-installation";
import { CLI_INSTALL_COMMAND, HOMEBREW_URL } from "./consts";

vi.mock("./brew", () => ({ findBrewPath: vi.fn(), installCliWithBrew: vi.fn() }));
vi.mock("./cli", () => ({ isCliInstalled: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("CLI installation alert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
    vi.mocked(isCliInstalled).mockReset().mockReturnValue(false);
    vi.mocked(findBrewPath).mockReturnValue("/opt/homebrew/bin/brew");
    vi.mocked(installCliWithBrew)
      .mockReset()
      .mockImplementation(async () => {
        vi.mocked(isCliInstalled).mockReturnValue(true);
      });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function progressToast() {
    await vi.advanceTimersByTimeAsync(0);
    return await vi.mocked(showToast).mock.results[0].value;
  }

  it("waits for explicit installation approval and allows cancellation", async () => {
    const approval = deferred<boolean>();
    vi.mocked(confirmAlert).mockReturnValue(approval.promise);
    const running = promptForCliInstallation();
    expect(installCliWithBrew).not.toHaveBeenCalled();
    approval.resolve(false);
    await running;
    expect(installCliWithBrew).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(confirmAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryAction: { title: "Install with Homebrew" },
        message: expect.stringContaining("run your command again"),
      }),
    );
  });

  it("finishes installation with instructions to run the command again", async () => {
    await promptForCliInstallation();
    const toast = await progressToast();
    expect(installCliWithBrew).toHaveBeenCalledOnce();
    expect(toast.style).toBe(Toast.Style.Success);
    expect(toast.message).toContain("Run your command again");
    expect(toast.show).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-shows the same progress toast beyond a minute and stops after success", async () => {
    const install = deferred<void>();
    vi.mocked(installCliWithBrew).mockReturnValue(install.promise);
    const running = promptForCliInstallation();
    const toast = await progressToast();
    await vi.advanceTimersByTimeAsync(66000);
    expect(showToast).toHaveBeenCalledOnce();
    expect(toast.show).toHaveBeenCalledTimes(22);
    expect(toast.style).toBe(Toast.Style.Animated);
    expect(toast.message).toBe("Homebrew can take several minutes. Keep Raycast open to see progress.");
    vi.mocked(isCliInstalled).mockReturnValue(true);
    install.resolve();
    await running;
    const finalShowCount = vi.mocked(toast.show).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(toast.show).toHaveBeenCalledTimes(finalShowCount);
    expect(toast.style).toBe(Toast.Style.Success);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for in-flight progress updates before showing the final result", async () => {
    const install = deferred<void>();
    const refresh = deferred<void>();
    vi.mocked(installCliWithBrew).mockReturnValue(install.promise);
    const running = promptForCliInstallation();
    const toast = await progressToast();
    vi.mocked(toast.show).mockReturnValueOnce(refresh.promise);
    await vi.advanceTimersByTimeAsync(9000);
    expect(toast.show).toHaveBeenCalledOnce();
    vi.mocked(isCliInstalled).mockReturnValue(true);
    install.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(toast.style).toBe(Toast.Style.Animated);
    expect(vi.getTimerCount()).toBe(0);
    refresh.resolve();
    await running;
    expect(toast.style).toBe(Toast.Style.Success);
    expect(toast.show).toHaveBeenCalledTimes(2);
  });

  it("stops progress updates after failure and provides a manual installation command", async () => {
    const install = deferred<void>();
    vi.mocked(installCliWithBrew).mockReturnValue(install.promise);
    const running = promptForCliInstallation();
    const toast = await progressToast();
    await vi.advanceTimersByTimeAsync(60000);
    install.reject(new Error("brew failed"));
    await running;
    expect(toast.style).toBe(Toast.Style.Failure);
    expect(toast.message).toBe("brew failed");
    await toast.primaryAction.onAction(toast);
    expect(Clipboard.copy).toHaveBeenCalledWith(CLI_INSTALL_COMMAND);
    const count = vi.mocked(toast.show).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(toast.show).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps installing if refreshing the toast fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const install = deferred<void>();
    vi.mocked(installCliWithBrew).mockReturnValue(install.promise);
    const running = promptForCliInstallation();
    const toast = await progressToast();
    vi.mocked(toast.show).mockRejectedValueOnce(new Error("toast unavailable"));
    await vi.advanceTimersByTimeAsync(6000);
    expect(toast.show).toHaveBeenCalledTimes(2);
    vi.mocked(isCliInstalled).mockReturnValue(true);
    install.resolve();
    await running;
    expect(toast.style).toBe(Toast.Style.Success);
  });

  it("offers Homebrew setup when brew is missing", async () => {
    vi.mocked(findBrewPath).mockReturnValue(null);
    await promptForCliInstallation();
    expect(installCliWithBrew).not.toHaveBeenCalled();
    const toast = await progressToast();
    expect(toast.style).toBe(Toast.Style.Failure);
    await toast.primaryAction.onAction(toast);
    expect(open).toHaveBeenCalledWith(HOMEBREW_URL);
  });

  it("requires detection after brew succeeds and offers CLI Path correction", async () => {
    vi.mocked(installCliWithBrew).mockResolvedValue(undefined);
    await promptForCliInstallation();
    const toast = await progressToast();
    expect(toast.style).toBe(Toast.Style.Failure);
    expect(toast.message).toContain("CLI Path");
    await toast.primaryAction.onAction(toast);
    expect(openExtensionPreferences).toHaveBeenCalledOnce();
  });

  it("skips brew if another installation completed while the alert was open", async () => {
    vi.mocked(isCliInstalled).mockReturnValue(true);
    await promptForCliInstallation();
    expect(installCliWithBrew).not.toHaveBeenCalled();
    const toast = await progressToast();
    expect(toast.style).toBe(Toast.Style.Success);
    expect(toast.message).toContain("Run your command again");
  });
});
