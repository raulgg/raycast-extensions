import { Cache, launchCommand, LaunchType, showToast, Toast } from "@raycast/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { launchRefreshUsageCacheIfNeeded, recordRefreshUsageCacheSuccess } from "./refreshUsageCacheLaunch";

function armedFlag(): string | undefined {
  return new Cache({ namespace: "refresh-usage-cache" }).get("armed-v1");
}

describe("refresh usage cache armed flag", () => {
  beforeEach(() => {
    new Cache({ namespace: "refresh-usage-cache" }).clear();
  });

  it("records an armed flag", () => {
    recordRefreshUsageCacheSuccess();
    expect(armedFlag()).toBe("1");
  });
});

describe("launchRefreshUsageCacheIfNeeded", () => {
  beforeEach(() => {
    new Cache({ namespace: "refresh-usage-cache" }).clear();
    vi.mocked(launchCommand).mockReset();
    vi.mocked(launchCommand).mockResolvedValue(undefined);
    vi.mocked(showToast).mockReset();
    vi.mocked(showToast).mockResolvedValue(undefined);
  });

  it("launches Refresh Usage Cache as UserInitiated when it has never succeeded", async () => {
    await expect(launchRefreshUsageCacheIfNeeded()).resolves.toBe(true);

    expect(launchCommand).toHaveBeenCalledTimes(1);
    expect(launchCommand).toHaveBeenCalledWith({
      name: "refresh-usage-cache",
      type: LaunchType.UserInitiated,
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it("does not launch once a successful run is recorded", async () => {
    recordRefreshUsageCacheSuccess();

    await expect(launchRefreshUsageCacheIfNeeded()).resolves.toBe(false);

    expect(launchCommand).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("shows a toast and does not throw when launchCommand fails", async () => {
    vi.mocked(launchCommand).mockRejectedValue(new Error("Command is not enabled"));

    await expect(launchRefreshUsageCacheIfNeeded()).resolves.toBe(false);

    expect(showToast).toHaveBeenCalledWith({
      style: Toast.Style.Failure,
      title: "Failed to Start Background Refresh",
      message: "Command is not enabled",
    });
  });

  it("does not record a successful run when launchCommand only starts the command", async () => {
    await launchRefreshUsageCacheIfNeeded();

    expect(armedFlag()).toBeUndefined();
  });

  it("retries on a later open if Refresh Usage Cache has still never succeeded", async () => {
    vi.mocked(launchCommand).mockRejectedValue(new Error("Command is not enabled"));

    await launchRefreshUsageCacheIfNeeded();
    await launchRefreshUsageCacheIfNeeded();

    expect(launchCommand).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledTimes(2);
  });

  it("still resolves when showing the failure toast fails", async () => {
    vi.mocked(launchCommand).mockRejectedValue(new Error("Command is not enabled"));
    vi.mocked(showToast).mockRejectedValue(new Error("toast failed"));

    await expect(launchRefreshUsageCacheIfNeeded()).resolves.toBe(false);
  });
});
