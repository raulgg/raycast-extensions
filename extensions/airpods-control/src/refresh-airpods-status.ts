import { LaunchType, type LaunchProps } from "@raycast/api";
import { runWithCliGuard } from "./setup/guard";
import { resetAirPodsStatusSubtitles, runAirPodsStatusRefresh } from "./status/refresh";

export default async function main({ launchType }: LaunchProps) {
  if (launchType === LaunchType.Background) {
    await runAirPodsStatusRefresh({ showFeedback: false });
    return;
  }

  await runWithCliGuard(() => runAirPodsStatusRefresh({ showFeedback: true }), {
    onUnavailable: resetAirPodsStatusSubtitles,
  });
}
