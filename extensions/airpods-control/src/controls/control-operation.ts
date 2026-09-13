import { launchCommand, LaunchType } from "@raycast/api";
import { CliError } from "../cli/errors";
import { type SubtitleRevision } from "../commands/launch-context";
import { REFRESH_AIRPODS_STATUS_COMMAND_NAME } from "../commands/names";
import { type ToastManager } from "../feedback/toast-manager";
import { type SubtitleChannel, withSubtitleOperation } from "../subtitles/coordination";

const OFF_NOT_APPLIED_HINT =
  "macOS did not confirm Off after the requested change. Off may be disabled in your AirPods noise-control settings; " +
  "if so, uncheck Off in the Cycle Listening Mode preferences and disable the Set to Off command.";

export async function runWithSubtitleOperation(
  channel: SubtitleChannel,
  toast: ToastManager,
  operation: (revision: SubtitleRevision) => Promise<void>,
): Promise<void> {
  let entered = false;
  try {
    await withSubtitleOperation(channel, async (revision) => {
      entered = true;
      await operation(revision);
    });
  } catch (error) {
    if (entered) throw error;

    // Report lock failures before any CLI call.
    await toast.setToFailure({ error });
  } finally {
    // Refresh after releasing the lock, including when the control action failed.
    if (entered) {
      try {
        await launchCommand({ name: REFRESH_AIRPODS_STATUS_COMMAND_NAME, type: LaunchType.Background });
      } catch (error) {
        console.error("Failed to launch AirPods status refresh after control action", error);
      }
    }
  }
}

export async function showCliFailure(
  toast: ToastManager,
  error: unknown,
  options: { offRequested?: boolean } = {},
): Promise<void> {
  if (error instanceof CliError) {
    if (error.code === "no-device") {
      await toast.setToFailure({ titleOverride: "AirPods not connected", error });
      return;
    }
    if (error.code === "no-op" && options.offRequested) {
      await toast.setToFailure({ titleOverride: "Off mode was not applied", error: new Error(OFF_NOT_APPLIED_HINT) });
      return;
    }
  }
  await toast.setToFailure({ error });
}
