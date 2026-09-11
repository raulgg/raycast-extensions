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

interface SubtitleDispatchResult {
  listeningMode: PromiseSettledResult<void>;
  conversationAwareness: PromiseSettledResult<void>;
}

export interface AirPodsStatusRefreshResult {
  listeningMode: PromiseSettledResult<ListeningModes>;
  conversationAwareness: PromiseSettledResult<ConversationAwarenessState>;
  subtitleDispatch: SubtitleDispatchResult;
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
): Promise<SubtitleDispatchResult> {
  const [listeningMode, conversationAwareness] = await Promise.allSettled([
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

  return { listeningMode, conversationAwareness };
}

function logSubtitleDispatchFailures(result: SubtitleDispatchResult): void {
  if (result.listeningMode.status === "rejected") {
    console.error("Failed to dispatch Cycle Listening Mode subtitle refresh", result.listeningMode.reason);
  }
  if (result.conversationAwareness.status === "rejected") {
    console.error(
      "Failed to dispatch Toggle Conversation Awareness subtitle refresh",
      result.conversationAwareness.reason,
    );
  }
}

export async function resetAirPodsStatusSubtitles(): Promise<void> {
  logSubtitleDispatchFailures(await dispatchSubtitleRefreshes(null, null));
}

export async function refreshAirPodsStatus(): Promise<AirPodsStatusRefreshResult> {
  const [listeningMode, conversationAwareness] = await Promise.allSettled([
    AirPodsControlCli.getListeningMode(),
    AirPodsControlCli.getConversationAwareness(),
  ]);
  const result = { listeningMode, conversationAwareness };

  const subtitleDispatch = await dispatchSubtitleRefreshes(
    listeningMode.status === "fulfilled" ? listeningMode.value : null,
    conversationAwareness.status === "fulfilled" ? conversationAwareness.value : null,
  );
  return { ...result, subtitleDispatch };
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

function subtitleDispatchFailureMessage(result: AirPodsStatusRefreshResult): string {
  const failures: Array<{ label: string; message: string }> = [];
  if (result.subtitleDispatch.listeningMode.status === "rejected") {
    failures.push({
      label: "Listening Mode subtitle",
      message: getErrorMessage(result.subtitleDispatch.listeningMode.reason),
    });
  }
  if (result.subtitleDispatch.conversationAwareness.status === "rejected") {
    failures.push({
      label: "Conversation Awareness subtitle",
      message: getErrorMessage(result.subtitleDispatch.conversationAwareness.reason),
    });
  }
  return failures.map(({ label, message }) => `${label}: ${message}`).join(" · ");
}

async function finishToast(toast: Toast, result: AirPodsStatusRefreshResult): Promise<void> {
  const listeningSucceeded = result.listeningMode.status === "fulfilled";
  const conversationSucceeded = result.conversationAwareness.status === "fulfilled";
  const listeningRefreshLaunched = result.subtitleDispatch.listeningMode.status === "fulfilled";
  const conversationRefreshLaunched = result.subtitleDispatch.conversationAwareness.status === "fulfilled";

  if (listeningSucceeded && conversationSucceeded && listeningRefreshLaunched && conversationRefreshLaunched) {
    toast.style = Toast.Style.Success;
    toast.title = "AirPods status read";
    toast.message = fulfilledStatusMessage(result);
    toast.primaryAction = undefined;
    toast.secondaryAction = undefined;
  } else {
    const partial = listeningSucceeded || conversationSucceeded;
    const confirmed = fulfilledStatusMessage(result);
    const readFailure = failureMessage(result);
    const dispatchFailure = subtitleDispatchFailureMessage(result);
    const failures = [readFailure, dispatchFailure].filter(Boolean);
    const message = [confirmed, ...failures].filter(Boolean).join(" · ");

    toast.style = Toast.Style.Failure;
    if (dispatchFailure && !readFailure) {
      toast.title = "Could not refresh subtitles";
    } else {
      toast.title = partial ? "AirPods status partially refreshed" : "Failed to refresh AirPods status";
    }
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
  } else {
    logSubtitleDispatchFailures(result.subtitleDispatch);
  }
}
