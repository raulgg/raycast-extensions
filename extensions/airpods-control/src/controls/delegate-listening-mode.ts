import { launchCommand, LaunchType } from "@raycast/api";
import { CYCLE_LISTENING_MODE_COMMAND_NAME } from "../commands/names";
import { runWithCliGuard } from "../setup/guard";
import { runSetListeningModeCommand } from "./listening-mode";
import type { ListeningModes } from "../airpods/types";
import type { SetListeningModeLaunchContext } from "../commands/launch-context";

export async function setListeningMode(mode: ListeningModes): Promise<void> {
  const context: SetListeningModeLaunchContext = { operation: "set", mode };

  // Keep setup in the originating command. Delegating an installation can time
  // out while the target is still running, which previously opened setup twice.
  await runWithCliGuard(async () => {
    try {
      await launchCommand({
        name: CYCLE_LISTENING_MODE_COMMAND_NAME,
        type: LaunchType.UserInitiated,
        context,
      });
    } catch (error) {
      console.warn("Could not delegate to Cycle Listening Mode; using the CLI fallback", error);
      await runSetListeningModeCommand(mode, { updateCycleSubtitle: false });
    }
  });
}
