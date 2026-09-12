import { launchCommand, LaunchType } from "@raycast/api";
import { runSetListeningModeCommand } from "./airpods-control";
import { runWithCliGuard } from "./cli-guard";
import { CYCLE_LISTENING_MODE_COMMAND_NAME } from "./consts";
import type { ListeningModes } from "./types";

export interface SetListeningModeLaunchContext {
  operation: "set";
  mode: ListeningModes;
}

const LISTENING_MODES: ReadonlySet<string> = new Set(["off", "anc", "transparency", "adaptive"]);

export function modeFromLaunchContext(context: unknown): ListeningModes | null {
  if (typeof context !== "object" || context === null) return null;

  const { operation, mode } = context as Record<string, unknown>;
  return operation === "set" && typeof mode === "string" && LISTENING_MODES.has(mode) ? (mode as ListeningModes) : null;
}

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
