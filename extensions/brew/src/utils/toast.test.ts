/**
 * `showActionToast` — how a progress toast finishes.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { environment, LaunchType, __raycast } from "./__mocks__/raycast-api";
import { preferences } from "./preferences";
import { showActionToast, showBrewFailureToast } from "./toast";

describe("showActionToast", () => {
  beforeEach(() => {
    __raycast.reset();
    preferences.closeAfterAction = false;
    environment.launchType = undefined;
  });

  it("finishes in place and drops Cancel", async () => {
    const handle = showActionToast({ title: "Installing Tinycast", cancelable: true });
    handle.updateMessage("Operation completed successfully");
    await handle.showSuccessHUD("Installed Tinycast");

    expect(__raycast.toasts).toHaveLength(1);
    const [toast] = __raycast.toasts;
    expect(toast.style).toBe("success");
    expect(toast.title).toBe("Installed Tinycast");
    expect(toast.message).toBeUndefined();
    expect(toast.primaryAction).toBeUndefined();
  });

  it("drops Cancel when a cancelable toast fails", async () => {
    const handle = showActionToast({ title: "Installing Tinycast", cancelable: true });
    await handle.showFailureHUD("Could not install Tinycast");

    const [toast] = __raycast.toasts;
    expect(toast.style).toBe("failure");
    expect(toast.primaryAction).toBeUndefined();
  });

  it("uses a HUD instead of a toast when the launch is background", async () => {
    environment.launchType = LaunchType.Background;
    const handle = showActionToast({ title: "Upgrading wget", message: "", cancelable: true });
    await handle.showSuccessHUD("Upgraded wget");

    expect(__raycast.toasts).toHaveLength(0);
    expect(__raycast.huds).toEqual(["Upgrading wget", "Upgraded wget"]);
  });

  it("reports a failure with a HUD when the launch is background", async () => {
    environment.launchType = LaunchType.Background;
    await showBrewFailureToast("Upgrade failed", new Error("bottle missing"));

    expect(__raycast.toasts).toHaveLength(0);
    expect(__raycast.huds).toEqual(["Upgrade failed. bottle missing"]);
  });

  it("shows a HUD instead when Close After Action is on", async () => {
    preferences.closeAfterAction = true;
    const handle = showActionToast({ title: "Installing Tinycast", cancelable: true });
    await handle.showSuccessHUD("Installed Tinycast");

    expect(__raycast.huds).toEqual(["✅ Installed Tinycast"]);
  });
});
