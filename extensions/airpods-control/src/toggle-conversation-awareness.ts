import { LaunchType, type LaunchProps } from "@raycast/api";
import {
  publishConversationAwarenessSubtitle,
  refreshConversationAwarenessSubtitle,
  runToggleConversationAwarenessCommand,
} from "./controls/airpods-control";
import { runWithCliGuard } from "./helper-setup/guard";
import {
  conversationAwarenessFromSubtitleRefreshContext,
  conversationAwarenessRevisionFromSubtitleRefreshContext,
  type ConversationAwarenessSubtitleRefreshContext,
} from "./status/refresh";
import { resetCommandSubtitle } from "./subtitles/coordination";

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
