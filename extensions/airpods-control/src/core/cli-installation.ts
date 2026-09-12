import { confirmAlert, showToast, Toast } from "@raycast/api";
import { installCliWithBrew, updateCliWithBrew } from "./brew";
import { detectCliSetup, type CliSetup } from "./cli-setup";
import { openCliSetup } from "./cli-setup-navigation";
import { createCopyErrorAction, getErrorMessage } from "./toast-manager";

export type CliOperation = "install" | "update";
const READY_MESSAGE = "Run your AirPods command again.";
let pendingPrompt: Promise<void> | undefined;
let pendingOperation: Promise<CliSetup> | undefined;

export async function runBrewOperationWithProgress<T>(toast: Toast, operation: () => Promise<T>): Promise<T> {
  let pendingShow: Promise<void> | undefined;
  // Re-show the same toast without letting a late refresh overwrite the result.
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
    return await operation();
  } finally {
    clearInterval(timer);
    await pendingShow;
  }
}

export function runCliInstallation(operation: CliOperation): Promise<CliSetup> {
  pendingOperation ??= performInstallation(operation).finally(() => {
    pendingOperation = undefined;
  });
  return pendingOperation;
}

async function performInstallation(operation: CliOperation): Promise<CliSetup> {
  let toast: Toast | undefined;
  try {
    const before = await detectCliSetup();
    // Installation may have finished elsewhere while the confirmation was open.
    if (operation === "install" && before.cliPath) {
      await showToast({ style: Toast.Style.Success, title: "AirPods Control helper ready", message: READY_MESSAGE });
      return before;
    }
    if (before.state !== operation) {
      throw new Error("Setup has changed. Choose the Refresh action in the setup view, then try again.");
    }
    toast = await showToast({
      style: Toast.Style.Animated,
      title: operation === "install" ? "Installing helper…" : "Updating helper…",
      message: "This can take several minutes. Keep Raycast open until it finishes.",
    });
    const after = await runBrewOperationWithProgress(toast, async () => {
      await (operation === "install" ? installCliWithBrew() : updateCliWithBrew());
      return detectCliSetup();
    });
    if (after.state !== "update") {
      throw new Error(
        "Homebrew finished, but the helper is not ready to use. Open Helper Setup to check the installation.",
      );
    }
    toast.style = Toast.Style.Success;
    toast.title = "AirPods Control helper ready";
    toast.message = READY_MESSAGE;
    await toast.show();
    return after;
  } catch (error) {
    const message = getErrorMessage(error);
    const options: Toast.Options = {
      style: Toast.Style.Failure,
      title: operation === "install" ? "Helper installation failed" : "Helper update failed",
      message,
      primaryAction: { title: "Open Helper Setup", onAction: openCliSetup },
      secondaryAction: createCopyErrorAction(message),
    };
    if (toast) {
      Object.assign(toast, options);
      await toast.show();
    } else {
      await showToast(options);
    }
    throw error;
  }
}

/** Setup never runs the AirPods action that originally required the CLI. */
export function promptForCliInstallation(): Promise<void> {
  pendingPrompt ??= offerInstallation().finally(() => {
    pendingPrompt = undefined;
  });
  return pendingPrompt;
}

async function offerInstallation(): Promise<void> {
  let setup: CliSetup;
  try {
    setup = await detectCliSetup();
  } catch {
    // The persistent view shows detection errors and provides a retry action.
    await openCliSetup();
    return;
  }
  if (setup.cliPath) {
    await showToast({ style: Toast.Style.Success, title: "AirPods Control helper ready", message: READY_MESSAGE });
    return;
  }
  if (setup.state !== "install") {
    await openCliSetup();
    return;
  }
  const confirmed = await confirmAlert({
    title: "Install AirPods Control helper?",
    message:
      "Install the helper to control your AirPods from Raycast. Homebrew can take several minutes. When it finishes, run your AirPods command again.",
    primaryAction: { title: "Install with Homebrew" },
    dismissAction: { title: "Cancel" },
  });
  if (!confirmed) return;
  try {
    await runCliInstallation("install");
  } catch {
    // The shared installer has already shown the error and recovery actions.
  }
}
