import { LaunchType, type LaunchProps } from "@raycast/api";
import {
  publishConversationAwarenessSubtitle,
  refreshConversationAwarenessSubtitle,
  runToggleConversationAwarenessCommand,
} from "./core/airpods-control";
import {
  conversationAwarenessFromSubtitleRefreshContext,
  conversationAwarenessRevisionFromSubtitleRefreshContext,
  type ConversationAwarenessSubtitleRefreshContext,
} from "./core/airpods-status-refresh";
import { runWithCliGuard } from "./core/cli-guard";
import { resetCommandSubtitle } from "./core/command-metadata";

type ToggleConversationAwarenessLaunchProps = LaunchProps<{
  launchContext?: ConversationAwarenessSubtitleRefreshContext;
}>;

export default async function main({ launchContext, launchType }: ToggleConversationAwarenessLaunchProps) {
  if (launchType === LaunchType.Background) {
    const state = conversationAwarenessFromSubtitleRefreshContext(launchContext);
    const revision = conversationAwarenessRevisionFromSubtitleRefreshContext(launchContext);
    if (state === undefined || revision === undefined) {
      await refreshConversationAwarenessSubtitle();
    } else {
      await publishConversationAwarenessSubtitle(state, revision);
    }
    return;
  }

  if (launchContext !== undefined) {
    await resetCommandSubtitle({ channel: "conversation-awareness" });
    throw new Error("Toggle Conversation Awareness received invalid launch context.");
  }

  await runWithCliGuard(runToggleConversationAwarenessCommand, {
    onUnavailable: () => resetCommandSubtitle({ channel: "conversation-awareness" }),
  });
}
