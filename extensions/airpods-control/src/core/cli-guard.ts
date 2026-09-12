import { showFailureToast } from "@raycast/utils";
import { isCliInstalled } from "./cli";
import { promptForCliInstallation } from "./cli-installation";
import { createCopyErrorAction, getErrorMessage } from "./toast-manager";

/**
 * Runs a CLI-backed no-view command action. When the airpods-control CLI is
 * missing, offers installation and returns without running the action.
 * No-view commands keep the command process alive until the promise resolves,
 * allowing progress and failure toasts to be updated in place.
 *
 * @param perform The CLI-backed action to execute
 * @param options.onUnavailable Optional cleanup before offering CLI installation
 */
export async function runWithCliGuard(
  perform: () => Promise<void>,
  options: { onUnavailable?: () => Promise<void> } = {},
): Promise<void> {
  try {
    if (!isCliInstalled()) {
      await options.onUnavailable?.();
      await promptForCliInstallation();
      return;
    }
    await perform();
  } catch (error) {
    // perform() reports its own failures; this is a last resort for unexpected ones.
    const message = getErrorMessage(error);
    await showFailureToast(error, {
      title: "AirPods command failed",
      message,
      primaryAction: createCopyErrorAction(message),
    });
  }
}
