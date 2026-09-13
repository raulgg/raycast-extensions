import { LaunchType, type LaunchProps } from "@raycast/api";
import {
  publishListeningModeSubtitle,
  refreshListeningModeSubtitle,
  runCycleListeningModeCommand,
  runSetListeningModeCommand,
} from "./core/airpods-control";
import {
  listeningModeFromSubtitleRefreshContext,
  listeningModeRevisionFromSubtitleRefreshContext,
  type ListeningModeSubtitleRefreshContext,
} from "./core/airpods-status-refresh";
import { runWithCliGuard } from "./core/cli-guard";
import { resetCommandSubtitle } from "./core/command-metadata";
import { modeFromLaunchContext, type SetListeningModeLaunchContext } from "./core/listening-mode-command";

type CycleListeningModeLaunchProps = LaunchProps<{
  launchContext?: SetListeningModeLaunchContext | ListeningModeSubtitleRefreshContext;
}>;

export default async function main({ launchContext, launchType }: CycleListeningModeLaunchProps) {
  if (launchType === LaunchType.Background) {
    const mode = listeningModeFromSubtitleRefreshContext(launchContext);
    const revision = listeningModeRevisionFromSubtitleRefreshContext(launchContext);
    if (mode === undefined || revision === undefined) {
      await refreshListeningModeSubtitle();
    } else {
      await publishListeningModeSubtitle(mode, revision);
    }
    return;
  }

  await runWithCliGuard(
    async () => {
      if (launchContext === undefined) {
        await runCycleListeningModeCommand();
        return;
      }

      const mode = modeFromLaunchContext(launchContext);
      if (!mode) {
        await resetCommandSubtitle({ channel: "listening-mode" });
        throw new Error("Cycle Listening Mode received invalid launch context.");
      }
      await runSetListeningModeCommand(mode, { updateCycleSubtitle: true });
    },
    { onUnavailable: () => resetCommandSubtitle({ channel: "listening-mode" }) },
  );
}
