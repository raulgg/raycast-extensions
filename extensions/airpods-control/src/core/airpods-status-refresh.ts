import { launchCommand, LaunchType, showToast, Toast } from "@raycast/api";
import * as AirPodsControlCli from "./airpods-control-cli";
import { CliError } from "./cli";
import {
  publishCommandSubtitle,
  resetCommandSubtitle,
  type SubtitleRevision,
  withSubtitleSnapshotOperation,
} from "./command-metadata";
import { CYCLE_LISTENING_MODE_COMMAND_NAME, TOGGLE_CONVERSATION_AWARENESS_COMMAND_NAME } from "./consts";
import { conversationAwarenessSubtitle, formatAirPodsStatusSubtitle, listeningModeSubtitle } from "./presentation";
import { createCopyErrorAction, getErrorMessage } from "./toast-manager";
import type { AirPodsStatusSnapshot, ConversationAwarenessState, ListeningModes } from "./types";

export interface ListeningModeSubtitleRefreshContext {
  operation: "refresh-listening-mode-subtitle";
  mode: ListeningModes | null;
  revision?: SubtitleRevision;
}

export interface ConversationAwarenessSubtitleRefreshContext {
  operation: "refresh-conversation-awareness-subtitle";
  state: ConversationAwarenessState | null;
  revision?: SubtitleRevision;
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

function revisionFromSubtitleRefreshContext(context: unknown, operation: string): SubtitleRevision | undefined {
  if (typeof context !== "object" || context === null) return undefined;

  const { operation: contextOperation, revision } = context as Record<string, unknown>;
  return contextOperation === operation && typeof revision === "string" && revision.length > 0 ? revision : undefined;
}

export function listeningModeRevisionFromSubtitleRefreshContext(context: unknown): SubtitleRevision | undefined {
  return revisionFromSubtitleRefreshContext(context, "refresh-listening-mode-subtitle");
}

export function conversationAwarenessRevisionFromSubtitleRefreshContext(
  context: unknown,
): SubtitleRevision | undefined {
  return revisionFromSubtitleRefreshContext(context, "refresh-conversation-awareness-subtitle");
}

async function dispatchSubtitleRefreshes(
  mode: ListeningModes | null,
  state: ConversationAwarenessState | null,
  listeningRevision?: SubtitleRevision,
  conversationRevision?: SubtitleRevision,
): Promise<SubtitleDispatchResult> {
  const listeningContext: ListeningModeSubtitleRefreshContext = {
    operation: "refresh-listening-mode-subtitle",
    mode,
    ...(listeningRevision ? { revision: listeningRevision } : {}),
  };
  const conversationContext: ConversationAwarenessSubtitleRefreshContext = {
    operation: "refresh-conversation-awareness-subtitle",
    state,
    ...(conversationRevision ? { revision: conversationRevision } : {}),
  };
  const [listeningMode, conversationAwareness] = await Promise.allSettled([
    launchCommand({
      name: CYCLE_LISTENING_MODE_COMMAND_NAME,
      type: LaunchType.Background,
      context: listeningContext,
    }),
    launchCommand({
      name: TOGGLE_CONVERSATION_AWARENESS_COMMAND_NAME,
      type: LaunchType.Background,
      context: conversationContext,
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
  try {
    await withSubtitleSnapshotOperation(async (revision) => {
      await resetCommandSubtitle({ channel: "status", revision });
      logSubtitleDispatchFailures(await dispatchSubtitleRefreshes(null, null, revision, revision));
    });
  } catch (error) {
    console.error("Failed to coordinate AirPods status subtitle reset", error);
  }
}

function statusSnapshot(result: {
  listeningMode: PromiseSettledResult<ListeningModes>;
  conversationAwareness: PromiseSettledResult<ConversationAwarenessState>;
}): AirPodsStatusSnapshot {
  return {
    listeningMode: result.listeningMode.status === "fulfilled" ? result.listeningMode.value : null,
    conversationAwareness:
      result.conversationAwareness.status === "fulfilled" ? result.conversationAwareness.value : null,
  };
}

function totalReadFailureIncludes(
  result: Pick<AirPodsStatusRefreshResult, "listeningMode" | "conversationAwareness">,
  code: "no-device" | "unavailable",
): boolean {
  if (result.listeningMode.status !== "rejected" || result.conversationAwareness.status !== "rejected") return false;

  return [result.listeningMode.reason, result.conversationAwareness.reason].some(
    (reason) => reason instanceof CliError && reason.code === code,
  );
}

async function publishStatusSubtitle(
  result: {
    listeningMode: PromiseSettledResult<ListeningModes>;
    conversationAwareness: PromiseSettledResult<ConversationAwarenessState>;
  },
  revision: SubtitleRevision,
): Promise<void> {
  const subtitle = formatAirPodsStatusSubtitle(statusSnapshot(result));
  if (subtitle) {
    await publishCommandSubtitle(subtitle, { channel: "status", revision });
  } else if (totalReadFailureIncludes(result, "no-device")) {
    await publishCommandSubtitle("Not connected", { channel: "status", revision });
  } else if (totalReadFailureIncludes(result, "unavailable")) {
    await resetCommandSubtitle({ channel: "status", revision });
  }
  // Preserve the last confirmed subtitle on transient or malformed reads.
}

function rejectedStatusReadResult(reason: unknown): {
  listeningMode: PromiseRejectedResult;
  conversationAwareness: PromiseRejectedResult;
} {
  return {
    listeningMode: { status: "rejected", reason },
    conversationAwareness: { status: "rejected", reason },
  };
}

export async function refreshAirPodsStatus(): Promise<AirPodsStatusRefreshResult> {
  try {
    return await withSubtitleSnapshotOperation(async (revision) => {
      const [listeningMode, conversationAwareness] = await Promise.allSettled([
        AirPodsControlCli.getListeningMode(),
        AirPodsControlCli.getConversationAwareness(),
      ]);
      const result = { listeningMode, conversationAwareness };

      await publishStatusSubtitle(result, revision);

      const subtitleDispatch = await dispatchSubtitleRefreshes(
        listeningMode.status === "fulfilled" ? listeningMode.value : null,
        conversationAwareness.status === "fulfilled" ? conversationAwareness.value : null,
        revision,
        revision,
      );
      return { ...result, subtitleDispatch };
    });
  } catch (reason) {
    // A failed coordination lock is reported like a failed read. The caller
    // dispatches a neutral context without a revision, retaining the existing
    // fallback behavior of the individual subtitle commands.
    const result = rejectedStatusReadResult(reason);
    const subtitleDispatch = await dispatchSubtitleRefreshes(null, null);
    return { ...result, subtitleDispatch };
  }
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
  } else if (totalReadFailureIncludes(result, "no-device") && listeningRefreshLaunched && conversationRefreshLaunched) {
    toast.style = Toast.Style.Success;
    toast.title = "AirPods not connected";
    toast.message = "Connect your AirPods to your Mac and try again.";
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
