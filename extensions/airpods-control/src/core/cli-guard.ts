import { launchCommand, LaunchType } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { isCliInstalled } from "./cli";
import { INSTALL_CLI_COMMAND_NAME } from "./consts";
import { createCopyErrorAction, getErrorMessage } from "./toast-manager";

/**
 * Runs a CLI-backed no-view command action. When the airpods-control CLI is
 * missing, opens the Install AirPods Control CLI view command instead.
 * No-view commands keep the command process alive until the promise resolves,
 * allowing progress and failure toasts to be updated in place.
 *
 * @param perform The CLI-backed action to execute
 * @param options.onUnavailable Optional cleanup before opening the CLI installer
 */
export async function runWithCliGuard(
  perform: () => Promise<void>,
  options: { onUnavailable?: () => Promise<void> } = {},
): Promise<void> {
  if (!isCliInstalled()) {
    await options.onUnavailable?.();
    await launchCommand({ name: INSTALL_CLI_COMMAND_NAME, type: LaunchType.UserInitiated });
    return;
  }

  try {
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
