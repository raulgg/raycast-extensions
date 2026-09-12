import { Clipboard, confirmAlert, open, openExtensionPreferences, showToast, Toast } from "@raycast/api";
import { findBrewPath, installCliWithBrew } from "./brew";
import { isCliInstalled } from "./cli";
import { CLI_INSTALL_COMMAND, HOMEBREW_URL } from "./consts";
import { createCopyErrorAction, getErrorMessage } from "./toast-manager";

export async function runBrewOperationWithProgress(toast: Toast, operation: () => Promise<void>): Promise<void> {
  let pendingShow: Promise<void> | undefined;
  // Raycast has no toast duration option. Re-show the same toast during long
  // builds, without overlapping updates or letting a late update replace the result.
  const timer = setInterval(() => {
    if (pendingShow) return;
    pendingShow = toast
      .show()
      .catch((error) => console.error("Could not refresh installation progress", error))
      .finally(() => {
        pendingShow = undefined;
      });
  }, 3000);

  try {
    await operation();
  } finally {
    clearInterval(timer);
    await pendingShow;
  }
}

/** Setup never runs the action that originally required the CLI. */
export async function promptForCliInstallation(): Promise<void> {
  const confirmed = await confirmAlert({
    title: "Install AirPods Control helper?",
    message: `This command needs the airpods-control CLI. Runs: ${CLI_INSTALL_COMMAND}. Homebrew and Apple's Command Line Tools are required. Installation can take several minutes. Once installed, run your command again.`,
    primaryAction: { title: "Install with Homebrew" },
    dismissAction: { title: "Cancel" },
  });
  if (!confirmed) return;

  let toast: Toast | undefined;
  let recovery: Toast.ActionOptions = {
    title: "Copy Install Command",
    onAction: () => Clipboard.copy(CLI_INSTALL_COMMAND),
  };

  try {
    // Another command or a manual installation may have completed during the alert.
    if (!isCliInstalled()) {
      if (!findBrewPath()) {
        recovery = { title: "Open Homebrew Website", onAction: () => open(HOMEBREW_URL) };
        throw new Error("Install Homebrew and Apple's Command Line Tools, then run your command again.");
      }
      toast = await showToast({
        style: Toast.Style.Animated,
        title: "Installing airpods-control…",
        message: "Homebrew can take several minutes. Keep Raycast open to see progress.",
      });
      await runBrewOperationWithProgress(toast, installCliWithBrew);
    }

    if (!isCliInstalled()) {
      recovery = { title: "Open Extension Preferences", onAction: openExtensionPreferences };
      throw new Error("The CLI still could not be detected. Clear or correct the custom CLI Path, then try again.");
    }

    if (toast) {
      toast.style = Toast.Style.Success;
      toast.title = "AirPods Control CLI installed";
      toast.message = "Ready. Run your command again to use it.";
      await toast.show();
    } else {
      await showToast({
        style: Toast.Style.Success,
        title: "AirPods Control CLI detected",
        message: "Ready. Run your command again to use it.",
      });
    }
  } catch (error) {
    const message = getErrorMessage(error);
    const options: Toast.Options = {
      style: Toast.Style.Failure,
      title: "CLI installation failed",
      message,
      primaryAction: recovery,
      secondaryAction: createCopyErrorAction(message),
    };
    if (toast) {
      Object.assign(toast, options);
      await toast.show();
    } else {
      await showToast(options);
    }
  }
}
