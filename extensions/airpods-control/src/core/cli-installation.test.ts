import { confirmAlert, launchCommand, showToast, Toast } from "@raycast/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cliSetup, deferred, installedCli } from "../test/cli-setup-fixture";
import { installCliWithBrew, updateCliWithBrew } from "./brew";
import { promptForCliInstallation, runCliInstallation } from "./cli-installation";
import { detectCliSetup } from "./cli-setup";

vi.mock("./brew", () => ({ installCliWithBrew: vi.fn(), updateCliWithBrew: vi.fn() }));
vi.mock("./cli-setup", () => ({ detectCliSetup: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
  vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
  vi.mocked(installCliWithBrew)
    .mockReset()
    .mockImplementation(async () => {
      vi.mocked(detectCliSetup).mockResolvedValue(installedCli);
    });
  vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function progressToast() {
  await vi.advanceTimersByTimeAsync(0);
  return await vi.mocked(showToast).mock.results[0].value;
}

describe("CLI installation entry points", () => {
  it.each(["installing", "needs-homebrew", "needs-developer-tools", "invalid-cli-path", "needs-link"] as const)(
    "opens persistent setup for %s without an install alert or failure toast",
    async (state) => {
      vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state }));
      await promptForCliInstallation();
      expect(launchCommand).toHaveBeenCalledWith({ name: "update-airpods-control-cli", type: "userInitiated" });
      expect(confirmAlert).not.toHaveBeenCalled();
      expect(installCliWithBrew).not.toHaveBeenCalled();
      expect(showToast).not.toHaveBeenCalled();
    },
  );
  it("opens setup when detection fails", async () => {
    vi.mocked(detectCliSetup).mockRejectedValueOnce(new Error("brew broken"));
    await promptForCliInstallation();
    expect(launchCommand).toHaveBeenCalledOnce();
    expect(confirmAlert).not.toHaveBeenCalled();
  });
  it("waits for explicit approval and allows cancellation", async () => {
    const approval = deferred<boolean>();
    vi.mocked(confirmAlert).mockReturnValue(approval.promise);
    const running = promptForCliInstallation();
    await vi.advanceTimersByTimeAsync(0);
    expect(installCliWithBrew).not.toHaveBeenCalled();
    approval.resolve(false);
    await running;
    expect(showToast).not.toHaveBeenCalled();
    expect(confirmAlert).toHaveBeenCalledWith(
      expect.objectContaining({ primaryAction: { title: "Install with Homebrew" } }),
    );
  });
  it("shares concurrent prompts and installs only once", async () => {
    const approval = deferred<boolean>();
    vi.mocked(confirmAlert).mockReturnValue(approval.promise);
    const first = promptForCliInstallation();
    const second = promptForCliInstallation();
    await vi.advanceTimersByTimeAsync(0);
    expect(confirmAlert).toHaveBeenCalledOnce();
    approval.resolve(true);
    await Promise.all([first, second]);
    expect(installCliWithBrew).toHaveBeenCalledOnce();
  });
  it("skips installation if another command installed the CLI while the alert was open", async () => {
    vi.mocked(detectCliSetup).mockResolvedValueOnce(cliSetup()).mockResolvedValue(installedCli);
    await promptForCliInstallation();
    expect(installCliWithBrew).not.toHaveBeenCalled();
    expect((await progressToast()).message).toContain("Run your AirPods command again");
  });
  it("does not install after prerequisites change during confirmation", async () => {
    vi.mocked(detectCliSetup)
      .mockResolvedValueOnce(cliSetup())
      .mockResolvedValue(cliSetup({ state: "needs-homebrew" }));
    await promptForCliInstallation();
    expect(installCliWithBrew).not.toHaveBeenCalled();
    expect((await progressToast()).style).toBe(Toast.Style.Failure);
  });
});

describe("shared installer", () => {
  it("finishes with manual rerun instructions", async () => {
    expect(await runCliInstallation("install")).toEqual(installedCli);
    const toast = await progressToast();
    expect(toast.style).toBe(Toast.Style.Success);
    expect(toast.message).toContain("Run your AirPods command again");
    expect(launchCommand).not.toHaveBeenCalled();
  });
  it("upgrades a Homebrew-managed CLI", async () => {
    vi.mocked(detectCliSetup).mockResolvedValue(installedCli);
    await runCliInstallation("update");
    expect(updateCliWithBrew).toHaveBeenCalledOnce();
    expect(installCliWithBrew).not.toHaveBeenCalled();
  });
  it("refuses to update a manual CLI", async () => {
    vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state: "manual-cli", cliPath: "/custom/cli" }));
    await expect(runCliInstallation("update")).rejects.toThrow("Setup has changed");
    expect(updateCliWithBrew).not.toHaveBeenCalled();
  });
  it("re-shows the same toast beyond a minute and stops after success", async () => {
    const install = deferred<void>();
    vi.mocked(installCliWithBrew).mockReturnValue(install.promise);
    const running = runCliInstallation("install");
    const toast = await progressToast();
    await vi.advanceTimersByTimeAsync(66000);
    expect(showToast).toHaveBeenCalledOnce();
    expect(toast.show).toHaveBeenCalledTimes(22);
    expect(toast.message).toBe("This can take several minutes. Keep Raycast open until it finishes.");
    vi.mocked(detectCliSetup).mockResolvedValue(installedCli);
    install.resolve();
    await running;
    const count = vi.mocked(toast.show).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(toast.show).toHaveBeenCalledTimes(count);
    expect(toast.style).toBe(Toast.Style.Success);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps refreshing while verifying the completed Homebrew installation", async () => {
    const verification = deferred<ReturnType<typeof cliSetup>>();
    vi.mocked(installCliWithBrew).mockImplementation(async () => {
      vi.mocked(detectCliSetup).mockReturnValue(verification.promise);
    });
    const running = runCliInstallation("install");
    const toast = await progressToast();
    await vi.advanceTimersByTimeAsync(12000);
    expect(toast.style).toBe(Toast.Style.Animated);
    expect(toast.show).toHaveBeenCalledTimes(4);
    verification.resolve(installedCli);
    await running;
    expect(toast.style).toBe(Toast.Style.Success);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for an in-flight refresh before publishing the final result", async () => {
    const install = deferred<void>();
    const refresh = deferred<void>();
    vi.mocked(installCliWithBrew).mockReturnValue(install.promise);
    const running = runCliInstallation("install");
    const toast = await progressToast();
    vi.mocked(toast.show).mockReturnValueOnce(refresh.promise);
    await vi.advanceTimersByTimeAsync(9000);
    expect(toast.show).toHaveBeenCalledOnce();
    vi.mocked(detectCliSetup).mockResolvedValue(installedCli);
    install.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(toast.style).toBe(Toast.Style.Animated);
    refresh.resolve();
    await running;
    expect(toast.style).toBe(Toast.Style.Success);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not abort brew when a progress refresh fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const install = deferred<void>();
    vi.mocked(installCliWithBrew).mockReturnValue(install.promise);
    const running = runCliInstallation("install");
    const toast = await progressToast();
    vi.mocked(toast.show).mockRejectedValueOnce(new Error("toast unavailable"));
    await vi.advanceTimersByTimeAsync(6000);
    expect(toast.show).toHaveBeenCalledTimes(2);
    vi.mocked(detectCliSetup).mockResolvedValue(installedCli);
    install.resolve();
    await running;
    expect(toast.style).toBe(Toast.Style.Success);
  });
  it("stops progress on failure and allows a later retry", async () => {
    vi.mocked(installCliWithBrew).mockRejectedValueOnce(new Error("brew failed\nrepair instructions"));
    await expect(runCliInstallation("install")).rejects.toThrow("repair instructions");
    const toast = await progressToast();
    expect(toast.style).toBe(Toast.Style.Failure);
    expect(vi.getTimerCount()).toBe(0);
    await toast.primaryAction.onAction(toast);
    expect(launchCommand).toHaveBeenCalledOnce();
    await expect(runCliInstallation("install")).resolves.toEqual(installedCli);
  });
  it("requires the active CLI to resolve to the Homebrew installation after success", async () => {
    vi.mocked(installCliWithBrew).mockResolvedValue(undefined);
    await expect(runCliInstallation("install")).rejects.toThrow("helper is not ready to use");
  });
  it("shares an in-flight operation across callers", async () => {
    const install = deferred<void>();
    vi.mocked(installCliWithBrew).mockReturnValue(install.promise);
    const first = runCliInstallation("install");
    const second = runCliInstallation("install");
    await vi.advanceTimersByTimeAsync(0);
    expect(installCliWithBrew).toHaveBeenCalledOnce();
    vi.mocked(detectCliSetup).mockResolvedValue(installedCli);
    install.resolve();
    await Promise.all([first, second]);
  });
});
