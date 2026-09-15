import { confirmAlert, launchCommand, showToast, Toast } from "@raycast/api";
import { expect, vi, test } from "vitest";
import { installCliWithBrew, updateCliWithBrew } from "../homebrew/commands";
import { expectConsoleError } from "../test/console";
import { cliSetup, installedCliSetup } from "../test/fixtures/cli-setup";
import { deferred } from "../test/fixtures/deferred";
import { detectCliSetup } from "./detection";
import { promptForCliInstallation, runCliInstallation } from "./installation";

vi.mock("../homebrew/commands", () => ({ installCliWithBrew: vi.fn(), updateCliWithBrew: vi.fn() }));

vi.mock("./detection", () => ({ detectCliSetup: vi.fn() }));

async function progressToast() {
  await vi.advanceTimersByTimeAsync(0);
  return await vi.mocked(showToast).mock.results[0].value;
}

test.each(["installing", "needs-homebrew", "needs-developer-tools", "invalid-cli-path", "needs-link"] as const)(
  "opens persistent setup for %s without an install alert or failure toast",
  async (state) => {
    // Given
    vi.useFakeTimers();
    try {
      vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
      vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
      vi.mocked(installCliWithBrew)
        .mockReset()
        .mockImplementation(async () => {
          vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
        });
      vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
      vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state }));
      // When
      await promptForCliInstallation();
      // Then
      expect(launchCommand).toHaveBeenCalledWith({ name: "update-airpods-control-cli", type: "userInitiated" });
      expect(confirmAlert).not.toHaveBeenCalled();
      expect(installCliWithBrew).not.toHaveBeenCalled();
      expect(showToast).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  },
);

test("opens setup when detection fails", async () => {
  // Given
  vi.useFakeTimers();
  try {
    vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
    vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
    vi.mocked(installCliWithBrew)
      .mockReset()
      .mockImplementation(async () => {
        vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      });
    vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
    vi.mocked(detectCliSetup).mockRejectedValueOnce(new Error("brew broken"));
    // When
    await promptForCliInstallation();
    // Then
    expect(launchCommand).toHaveBeenCalledOnce();
    expect(confirmAlert).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("waits for explicit approval and allows cancellation", async () => {
  // Given
  vi.useFakeTimers();
  try {
    vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
    vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
    vi.mocked(installCliWithBrew)
      .mockReset()
      .mockImplementation(async () => {
        vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      });
    vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
    const approval = deferred<boolean>();
    vi.mocked(confirmAlert).mockReturnValue(approval.promise);
    // When
    const running = promptForCliInstallation();
    try {
      await vi.advanceTimersByTimeAsync(0);
      // Then
      expect(installCliWithBrew).not.toHaveBeenCalled();
      // When
      approval.resolve(false);
      await running;
      // Then
      expect(showToast).not.toHaveBeenCalled();
      expect(confirmAlert).toHaveBeenCalledWith(
        expect.objectContaining({ primaryAction: { title: "Install with Homebrew" } }),
      );
    } finally {
      approval.resolve(false);
      await Promise.allSettled([running]);
    }
  } finally {
    vi.useRealTimers();
  }
});

test("shares concurrent prompts and installs only once", async () => {
  // Given
  vi.useFakeTimers();
  try {
    vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
    vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
    vi.mocked(installCliWithBrew)
      .mockReset()
      .mockImplementation(async () => {
        vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      });
    vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
    const approval = deferred<boolean>();
    vi.mocked(confirmAlert).mockReturnValue(approval.promise);
    // When
    const first = promptForCliInstallation();
    const second = promptForCliInstallation();
    try {
      await vi.advanceTimersByTimeAsync(0);
      // Then
      expect(confirmAlert).toHaveBeenCalledOnce();
      // When
      approval.resolve(true);
      await Promise.all([first, second]);
      // Then
      expect(installCliWithBrew).toHaveBeenCalledOnce();
    } finally {
      approval.resolve(false);
      await Promise.allSettled([first, second]);
    }
  } finally {
    vi.useRealTimers();
  }
});

test("skips installation if another command installed the CLI while the alert was open", async () => {
  // Given
  vi.useFakeTimers();
  try {
    vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
    vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
    vi.mocked(installCliWithBrew)
      .mockReset()
      .mockImplementation(async () => {
        vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      });
    vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
    vi.mocked(detectCliSetup).mockResolvedValueOnce(cliSetup()).mockResolvedValue(installedCliSetup());
    // When
    await promptForCliInstallation();
    // Then
    expect(installCliWithBrew).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ style: Toast.Style.Success }));
    expect(launchCommand).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("does not install after prerequisites change during confirmation", async () => {
  // Given
  vi.useFakeTimers();
  try {
    vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
    vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
    vi.mocked(installCliWithBrew)
      .mockReset()
      .mockImplementation(async () => {
        vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      });
    vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
    vi.mocked(detectCliSetup)
      .mockResolvedValueOnce(cliSetup())
      .mockResolvedValue(cliSetup({ state: "needs-homebrew" }));
    // When
    await promptForCliInstallation();
    // Then
    expect(installCliWithBrew).not.toHaveBeenCalled();
    expect((await progressToast()).style).toBe(Toast.Style.Failure);
  } finally {
    vi.useRealTimers();
  }
});

test("returns the verified helper without resuming an AirPods command", async () => {
  // Given
  vi.useFakeTimers();
  try {
    vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
    vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
    vi.mocked(installCliWithBrew)
      .mockReset()
      .mockImplementation(async () => {
        vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      });
    vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
    // When
    const result = await runCliInstallation("install");
    // Then
    expect(result).toEqual(installedCliSetup());
    const toast = await progressToast();
    expect(toast.style).toBe(Toast.Style.Success);

    expect(launchCommand).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("upgrades a Homebrew-managed CLI", async () => {
  // Given
  vi.useFakeTimers();
  try {
    vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
    vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
    vi.mocked(installCliWithBrew)
      .mockReset()
      .mockImplementation(async () => {
        vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      });
    vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
    vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
    // When
    await runCliInstallation("update");
    // Then
    expect(updateCliWithBrew).toHaveBeenCalledOnce();
    expect(installCliWithBrew).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("refuses to update a manual CLI", async () => {
  // Given
  vi.useFakeTimers();
  try {
    vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
    vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
    vi.mocked(installCliWithBrew)
      .mockReset()
      .mockImplementation(async () => {
        vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      });
    vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
    vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state: "manual-cli", cliPath: "/custom/cli" }));
    // When
    const result = runCliInstallation("update");
    // Then
    await expect(result).rejects.toThrow("Setup has changed");
    expect(updateCliWithBrew).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("re-shows the same toast beyond a minute and stops after success", async () => {
  // Given
  vi.useFakeTimers();
  try {
    vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
    vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
    vi.mocked(installCliWithBrew)
      .mockReset()
      .mockImplementation(async () => {
        vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      });
    vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
    const install = deferred<void>();
    vi.mocked(installCliWithBrew).mockReturnValue(install.promise);
    // When
    const running = runCliInstallation("install");
    try {
      const toast = await progressToast();
      await vi.advanceTimersByTimeAsync(66000);
      // Then
      expect(showToast).toHaveBeenCalledOnce();
      expect(toast.show).toHaveBeenCalled();

      vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      // When
      install.resolve();
      await running;
      // Then
      const count = vi.mocked(toast.show).mock.calls.length;
      // When
      await vi.advanceTimersByTimeAsync(60000);
      // Then
      expect(toast.show).toHaveBeenCalledTimes(count);
      expect(toast.style).toBe(Toast.Style.Success);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      install.resolve();
      await Promise.allSettled([running]);
    }
  } finally {
    vi.useRealTimers();
  }
});

test("keeps refreshing while verifying the completed Homebrew installation", async () => {
  // Given
  vi.useFakeTimers();
  try {
    vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
    vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
    vi.mocked(installCliWithBrew)
      .mockReset()
      .mockImplementation(async () => {
        vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      });
    vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
    const verification = deferred<ReturnType<typeof cliSetup>>();
    vi.mocked(installCliWithBrew).mockImplementation(async () => {
      vi.mocked(detectCliSetup).mockReturnValue(verification.promise);
    });
    // When
    const running = runCliInstallation("install");
    try {
      const toast = await progressToast();
      await vi.advanceTimersByTimeAsync(12000);
      // Then
      expect(toast.style).toBe(Toast.Style.Animated);
      expect(toast.show).toHaveBeenCalled();
      // When
      verification.resolve(installedCliSetup());
      await running;
      // Then
      expect(toast.style).toBe(Toast.Style.Success);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      verification.resolve(installedCliSetup());
      await Promise.allSettled([running]);
    }
  } finally {
    vi.useRealTimers();
  }
});

test("waits for an in-flight refresh before publishing the final result", async () => {
  // Given
  vi.useFakeTimers();
  try {
    vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
    vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
    vi.mocked(installCliWithBrew)
      .mockReset()
      .mockImplementation(async () => {
        vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      });
    vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
    const install = deferred<void>();
    const refresh = deferred<void>();
    vi.mocked(installCliWithBrew).mockReturnValue(install.promise);
    // When
    const running = runCliInstallation("install");
    try {
      const toast = await progressToast();
      vi.mocked(toast.show).mockReturnValueOnce(refresh.promise);
      await vi.advanceTimersByTimeAsync(9000);
      // Then
      expect(toast.show).toHaveBeenCalledOnce();
      vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      // When
      install.resolve();
      await vi.advanceTimersByTimeAsync(0);
      // Then
      expect(toast.style).toBe(Toast.Style.Animated);
      // When
      refresh.resolve();
      await running;
      // Then
      expect(toast.style).toBe(Toast.Style.Success);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      install.resolve();
      refresh.resolve();
      await Promise.allSettled([running]);
    }
  } finally {
    vi.useRealTimers();
  }
});

test("does not abort brew when a progress refresh fails", async () => {
  // Given
  vi.useFakeTimers();
  try {
    vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
    vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
    vi.mocked(installCliWithBrew)
      .mockReset()
      .mockImplementation(async () => {
        vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      });
    vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
    const refreshError = new Error("toast unavailable");
    expectConsoleError("Could not refresh installation progress", refreshError);
    const install = deferred<void>();
    vi.mocked(installCliWithBrew).mockReturnValue(install.promise);
    // When
    const running = runCliInstallation("install");
    try {
      const toast = await progressToast();
      vi.mocked(toast.show).mockRejectedValueOnce(refreshError);
      await vi.advanceTimersByTimeAsync(6000);
      // Then
      expect(toast.show).toHaveBeenCalledTimes(2);
      vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      // When
      install.resolve();
      await running;
      // Then
      expect(toast.style).toBe(Toast.Style.Success);
    } finally {
      install.resolve();
      await Promise.allSettled([running]);
    }
  } finally {
    vi.useRealTimers();
  }
});

test("stops progress on failure and allows a later retry", async () => {
  // Given
  vi.useFakeTimers();
  try {
    vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
    vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
    vi.mocked(installCliWithBrew)
      .mockReset()
      .mockImplementation(async () => {
        vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      });
    vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
    vi.mocked(installCliWithBrew).mockRejectedValueOnce(new Error("brew failed\nrepair instructions"));
    // When
    const result = runCliInstallation("install");
    // Then
    await expect(result).rejects.toThrow("repair instructions");
    const toast = await progressToast();
    expect(toast.style).toBe(Toast.Style.Failure);
    expect(vi.getTimerCount()).toBe(0);
    // When
    await toast.primaryAction.onAction(toast);
    // Then
    expect(launchCommand).toHaveBeenCalledOnce();
    // When
    const result2 = runCliInstallation("install");
    // Then
    await expect(result2).resolves.toEqual(installedCliSetup());
  } finally {
    vi.useRealTimers();
  }
});

test("requires the active CLI to resolve to the Homebrew installation after success", async () => {
  // Given
  vi.useFakeTimers();
  try {
    vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
    vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
    vi.mocked(installCliWithBrew)
      .mockReset()
      .mockImplementation(async () => {
        vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      });
    vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
    vi.mocked(installCliWithBrew).mockResolvedValue(undefined);
    // When
    const result = runCliInstallation("install");
    // Then
    await expect(result).rejects.toThrow("CLI is not ready to use");
  } finally {
    vi.useRealTimers();
  }
});

test("shares an in-flight operation across callers", async () => {
  // Given
  vi.useFakeTimers();
  try {
    vi.mocked(confirmAlert).mockReset().mockResolvedValue(true);
    vi.mocked(detectCliSetup).mockReset().mockResolvedValue(cliSetup());
    vi.mocked(installCliWithBrew)
      .mockReset()
      .mockImplementation(async () => {
        vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      });
    vi.mocked(updateCliWithBrew).mockReset().mockResolvedValue(undefined);
    const install = deferred<void>();
    vi.mocked(installCliWithBrew).mockReturnValue(install.promise);
    // When
    const first = runCliInstallation("install");
    const second = runCliInstallation("install");
    try {
      await vi.advanceTimersByTimeAsync(0);
      // Then
      expect(installCliWithBrew).toHaveBeenCalledOnce();
      vi.mocked(detectCliSetup).mockResolvedValue(installedCliSetup());
      // When
      install.resolve();
      await Promise.all([first, second]);
    } finally {
      install.resolve();
      await Promise.allSettled([first, second]);
    }
  } finally {
    vi.useRealTimers();
  }
});
