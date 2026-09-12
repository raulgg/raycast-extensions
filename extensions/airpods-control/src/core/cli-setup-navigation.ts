import { launchCommand, LaunchType, open, showToast, Toast } from "@raycast/api";
import { CLI_INSTALL_DOCS_URL, CLI_SETUP_COMMAND_NAME } from "./consts";
import { createCopyErrorAction, getErrorMessage } from "./toast-manager";

export async function openCliSetup(): Promise<void> {
  try {
    await launchCommand({ name: CLI_SETUP_COMMAND_NAME, type: LaunchType.UserInitiated });
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could not open CLI setup",
      message: "Enable Update Airpods-Control CLI in Raycast preferences, or follow the installation instructions.",
      primaryAction: { title: "Open Installation Instructions", onAction: () => open(CLI_INSTALL_DOCS_URL) },
      secondaryAction: createCopyErrorAction(getErrorMessage(error)),
    });
  }
}
