import { launchCommand, LaunchType, showToast, Toast } from "@raycast/api";
import * as AirPodsControlCli from "./airpods-control-cli";
import { CYCLE_LISTENING_MODE_COMMAND_NAME, TOGGLE_CONVERSATION_AWARENESS_COMMAND_NAME } from "./consts";
import { conversationAwarenessSubtitle, listeningModeSubtitle } from "./presentation";
import { createCopyErrorAction, getErrorMessage } from "./toast-manager";
import type { ConversationAwarenessState, ListeningModes } from "./types";

export interface ListeningModeSubtitleRefreshContext {
  operation: "refresh-listening-mode-subtitle";
  mode: ListeningModes | null;
}

export interface ConversationAwarenessSubtitleRefreshContext {
  operation: "refresh-conversation-awareness-subtitle";
  state: ConversationAwarenessState | null;
}

export interface AirPodsStatusRefreshResult {
  listeningMode: PromiseSettledResult<ListeningModes>;
  conversationAwareness: PromiseSettledResult<ConversationAwarenessState>;
}

const LISTENING_MODES: ReadonlySet<string> = new Set(["off", "anc", "transparency", "adaptive"]);

export function listeningModeFromSubtitleRefreshContext(context: unknown): ListeningModes | null | undefined {
  if (typeof context !== "object" || context === null) return undefined;

  const { operation, mode } = context as Record<string, unknown>;
  if (operation !== "refresh-listening-mode-subtitle") return undefined;
  if (mode === null) return null;
  return typeof mode === "string" && LISTENING_MODES.has(mode) ? (mode as ListeningModes) : undefined;
}

export function conversationAwarenessFromSubtitleRefreshContext(
  context: unknown,
): ConversationAwarenessState | null | undefined {
  if (typeof context !== "object" || context === null) return undefined;

  const { operation, state } = context as Record<string, unknown>;
  if (operation !== "refresh-conversation-awareness-subtitle") return undefined;
  if (state === null) return null;
  return state === "on" || state === "off" ? state : undefined;
}

async function dispatchSubtitleRefreshes(
  mode: ListeningModes | null,
  state: ConversationAwarenessState | null,
): Promise<void> {
  await Promise.allSettled([
    launchCommand({
      name: CYCLE_LISTENING_MODE_COMMAND_NAME,
      type: LaunchType.Background,
      context: { operation: "refresh-listening-mode-subtitle", mode } satisfies ListeningModeSubtitleRefreshContext,
    }),
    launchCommand({
      name: TOGGLE_CONVERSATION_AWARENESS_COMMAND_NAME,
      type: LaunchType.Background,
      context: {
        operation: "refresh-conversation-awareness-subtitle",
        state,
      } satisfies ConversationAwarenessSubtitleRefreshContext,
    }),
  ]);
}

export async function resetAirPodsStatusSubtitles(): Promise<void> {
  await dispatchSubtitleRefreshes(null, null);
}

export async function refreshAirPodsStatus(): Promise<AirPodsStatusRefreshResult> {
  const [listeningMode, conversationAwareness] = await Promise.allSettled([
    AirPodsControlCli.getListeningMode(),
    AirPodsControlCli.getConversationAwareness(),
  ]);
  const result = { listeningMode, conversationAwareness };

  await dispatchSubtitleRefreshes(
    listeningMode.status === "fulfilled" ? listeningMode.value : null,
    conversationAwareness.status === "fulfilled" ? conversationAwareness.value : null,
  );
  return result;
}

function fulfilledStatusMessage(result: AirPodsStatusRefreshResult): string {
  const parts: string[] = [];
  if (result.listeningMode.status === "fulfilled") {
    parts.push(`Listening: ${listeningModeSubtitle(result.listeningMode.value)}`);
  }
  if (result.conversationAwareness.status === "fulfilled") {
    parts.push(`Conversation Awareness: ${conversationAwarenessSubtitle(result.conversationAwareness.value)}`);
  }
  return parts.join(" · ");
}

function failureMessage(result: AirPodsStatusRefreshResult): string {
  const failures: Array<{ label: string; message: string }> = [];
  if (result.listeningMode.status === "rejected") {
    failures.push({ label: "Listening Mode", message: getErrorMessage(result.listeningMode.reason) });
  }
  if (result.conversationAwareness.status === "rejected") {
    failures.push({
      label: "Conversation Awareness",
      message: getErrorMessage(result.conversationAwareness.reason),
    });
  }

  if (failures.length === 2 && failures[0].message === failures[1].message) {
    return failures[0].message;
  }
  return failures.map(({ label, message }) => `${label}: ${message}`).join(" · ");
}

async function finishToast(toast: Toast, result: AirPodsStatusRefreshResult): Promise<void> {
  const listeningSucceeded = result.listeningMode.status === "fulfilled";
  const conversationSucceeded = result.conversationAwareness.status === "fulfilled";

  if (listeningSucceeded && conversationSucceeded) {
    toast.style = Toast.Style.Success;
    toast.title = "AirPods status refreshed";
    toast.message = fulfilledStatusMessage(result);
    toast.primaryAction = undefined;
    toast.secondaryAction = undefined;
  } else {
    const partial = listeningSucceeded || conversationSucceeded;
    const failure = failureMessage(result);
    const confirmed = fulfilledStatusMessage(result);
    const message = confirmed ? `${confirmed} · ${failure}` : failure;

    toast.style = Toast.Style.Failure;
    toast.title = partial ? "AirPods status partially refreshed" : "Failed to refresh AirPods status";
    toast.message = message;
    toast.primaryAction = createCopyErrorAction(message);
    toast.secondaryAction = undefined;
  }

  await toast.show();
}

export async function runAirPodsStatusRefresh({ showFeedback }: { showFeedback: boolean }): Promise<void> {
  const toast = showFeedback
    ? await showToast({
        style: Toast.Style.Animated,
        title: "Refreshing AirPods status...",
      })
    : null;
  const result = await refreshAirPodsStatus();

  if (toast) {
    await finishToast(toast, result);
  }
}
