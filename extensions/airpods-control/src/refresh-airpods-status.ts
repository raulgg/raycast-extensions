import { LaunchType, type LaunchProps } from "@raycast/api";
import { resetAirPodsStatusSubtitles, runAirPodsStatusRefresh } from "./core/airpods-status-refresh";
import { runWithCliGuard } from "./core/cli-guard";

export default async function main({ launchType }: LaunchProps) {
  if (launchType === LaunchType.Background) {
    await runAirPodsStatusRefresh({ showFeedback: false });
    return;
  }

  await runWithCliGuard(() => runAirPodsStatusRefresh({ showFeedback: true }), {
    onUnavailable: resetAirPodsStatusSubtitles,
  });
}
