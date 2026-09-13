import { getPreferenceValues, launchCommand, LaunchType, openCommandPreferences } from "@raycast/api";
import {
  conversationAwarenessHud,
  conversationAwarenessSubtitle,
  LISTENING_MODE_PRESENTATION,
  listeningModeHud,
  listeningModeSubtitle,
} from "../airpods/presentation";
import * as AirPodsControlCli from "../cli/client";
import { CliError } from "../cli/transport";
import { ToastManager } from "../feedback/toast-manager";
import { CYCLE_MODE_ORDER, REFRESH_AIRPODS_STATUS_COMMAND_NAME } from "../helper-setup/constants";
import {
  publishCommandSubtitle,
  resetCommandSubtitle,
  type SubtitleChannel,
  type SubtitleRevision,
  withSubtitleOperation,
} from "../subtitles/coordination";
import type { ConversationAwarenessState, CycleCommandPreferences, ListeningModes } from "../airpods/types";

const OFF_NOT_APPLIED_HINT =
  "macOS did not confirm Off after the requested change. Off may be disabled in your AirPods noise-control settings; " +
  "if so, uncheck Off in the Cycle Listening Mode preferences and disable the Set to Off command.";

interface SetListeningModeCommandOptions {
  updateCycleSubtitle: boolean;
}

async function runWithSubtitleOperation(
  channel: SubtitleChannel,
  toast: ToastManager,
  operation: (revision: SubtitleRevision) => Promise<void>,
): Promise<void> {
  let entered = false;
  try {
    await withSubtitleOperation(channel, async (revision) => {
      entered = true;
      await operation(revision);
    });
  } catch (error) {
    if (entered) throw error;

    // Report lock failures before any CLI call.
    await toast.setToFailure({ error });
  } finally {
    // Refresh after releasing the lock, including when the control action failed.
    if (entered) {
      try {
        await launchCommand({ name: REFRESH_AIRPODS_STATUS_COMMAND_NAME, type: LaunchType.Background });
      } catch (error) {
        console.error("Failed to launch AirPods status refresh after control action", error);
      }
    }
  }
}

async function refreshCommandSubtitle<State>(
  readState: () => Promise<State>,
  publishState: (state: State | null, revision?: SubtitleRevision) => Promise<void>,
  revision?: SubtitleRevision,
): Promise<void> {
  try {
    await publishState(await readState(), revision);
  } catch {
    await publishState(null, revision);
  }
}

export async function publishListeningModeSubtitle(
  mode: ListeningModes | null,
  revision?: SubtitleRevision,
): Promise<void> {
  if (mode) {
    await publishCommandSubtitle(listeningModeSubtitle(mode), { channel: "listening-mode", revision });
  } else {
    await resetCommandSubtitle({ channel: "listening-mode", revision });
  }
}

export async function publishConversationAwarenessSubtitle(
  state: ConversationAwarenessState | null,
  revision?: SubtitleRevision,
): Promise<void> {
  if (state) {
    await publishCommandSubtitle(conversationAwarenessSubtitle(state), { channel: "conversation-awareness", revision });
  } else {
    await resetCommandSubtitle({ channel: "conversation-awareness", revision });
  }
}

export async function refreshListeningModeSubtitle(): Promise<void> {
  try {
    await withSubtitleOperation("listening-mode", async (revision) => {
      await refreshCommandSubtitle(AirPodsControlCli.getListeningMode, publishListeningModeSubtitle, revision);
    });
  } catch (error) {
    console.error("Failed to coordinate listening-mode refresh", error);
  }
}

export async function refreshConversationAwarenessSubtitle(): Promise<void> {
  try {
    await withSubtitleOperation("conversation-awareness", async (revision) => {
      await refreshCommandSubtitle(
        AirPodsControlCli.getConversationAwareness,
        publishConversationAwarenessSubtitle,
        revision,
      );
    });
  } catch (error) {
    console.error("Failed to coordinate Conversation Awareness refresh", error);
  }
}

async function publishConfirmedListeningMode(
  error: unknown,
  enabled: boolean,
  revision?: SubtitleRevision,
): Promise<void> {
  if (!enabled) return;

  const mode = error instanceof CliError ? AirPodsControlCli.confirmedListeningMode(error.payload) : null;
  await publishListeningModeSubtitle(mode, revision);
}

async function publishConfirmedConversationAwareness(error: unknown, revision?: SubtitleRevision): Promise<void> {
  const state = error instanceof CliError ? AirPodsControlCli.confirmedConversationAwareness(error.payload) : null;
  await publishConversationAwarenessSubtitle(state, revision);
}

async function showCliFailure(
  toast: ToastManager,
  error: unknown,
  options: { offRequested?: boolean } = {},
): Promise<void> {
  if (error instanceof CliError) {
    if (error.code === "no-device") {
      await toast.setToFailure({ titleOverride: "AirPods not connected", error });
      return;
    }
    if (error.code === "no-op" && options.offRequested) {
      await toast.setToFailure({ titleOverride: "Off mode was not applied", error: new Error(OFF_NOT_APPLIED_HINT) });
      return;
    }
  }
  await toast.setToFailure({ error });
}

export async function runSetListeningModeCommand(
  modeToActivate: ListeningModes,
  { updateCycleSubtitle }: SetListeningModeCommandOptions,
): Promise<void> {
  const { label } = LISTENING_MODE_PRESENTATION[modeToActivate];
  const toast = new ToastManager({
    loading: `Setting AirPods to ${label}...`,
    success: listeningModeHud(modeToActivate),
    failure: `Failed to set AirPods to ${label}`,
  });
  await toast.setToLoading();

  const run = async (revision: SubtitleRevision): Promise<void> => {
    try {
      const confirmedMode = await AirPodsControlCli.setListeningMode(modeToActivate);
      if (updateCycleSubtitle) {
        await publishListeningModeSubtitle(confirmedMode, revision);
      }
      await toast.setToSuccess({ titleOverride: listeningModeHud(confirmedMode) });
    } catch (error) {
      await publishConfirmedListeningMode(error, updateCycleSubtitle, revision);
      await showCliFailure(toast, error, { offRequested: modeToActivate === "off" });
    }
  };

  await runWithSubtitleOperation("listening-mode", toast, run);
}

function getSelectedCycleModes(): ListeningModes[] {
  const preferences = getPreferenceValues<CycleCommandPreferences>();
  const isSelected: Record<ListeningModes, boolean> = {
    off: preferences.cycleOff,
    transparency: preferences.cycleTransparency,
    adaptive: preferences.cycleAdaptive,
    anc: preferences.cycleAnc,
  };
  return CYCLE_MODE_ORDER.filter((mode) => isSelected[mode]);
}

export async function runCycleListeningModeCommand(): Promise<void> {
  const toast = new ToastManager({
    loading: "Cycling listening mode...",
    success: "Cycled listening mode",
    failure: "Failed to cycle listening mode",
  });
  await toast.setToLoading();

  const selectedModes = getSelectedCycleModes();
  if (selectedModes.length < 2) {
    await toast.setToFailure({
      error: new Error("Select at least two listening modes in Cycle Listening Mode preferences."),
      action: {
        title: "Open Command Preferences",
        onAction: openCommandPreferences,
      },
    });
    return;
  }

  const run = async (revision: SubtitleRevision): Promise<void> => {
    try {
      const confirmedMode = await AirPodsControlCli.cycleListeningMode(selectedModes);
      await publishListeningModeSubtitle(confirmedMode, revision);
      await toast.setToSuccess({
        titleOverride: listeningModeHud(confirmedMode),
      });
    } catch (error) {
      await publishConfirmedListeningMode(error, true, revision);
      if (error instanceof CliError && error.code === "unsupported") {
        await toast.setToFailure({
          error: new Error(
            "Your AirPods support fewer than two of the selected cycle modes. Adjust the command preferences.",
          ),
          action: {
            title: "Open Command Preferences",
            onAction: openCommandPreferences,
          },
        });
        return;
      }
      await showCliFailure(toast, error, { offRequested: selectedModes.includes("off") });
    }
  };

  await runWithSubtitleOperation("listening-mode", toast, run);
}

export async function runToggleConversationAwarenessCommand(): Promise<void> {
  const toast = new ToastManager({
    loading: "Toggling Conversation Awareness...",
    success: "Toggled Conversation Awareness",
    failure: "Failed to toggle Conversation Awareness",
  });
  await toast.setToLoading();

  const run = async (revision: SubtitleRevision): Promise<void> => {
    try {
      const currentState = await AirPodsControlCli.getConversationAwareness();
      const nextState: ConversationAwarenessState = currentState === "on" ? "off" : "on";
      const confirmedState = await AirPodsControlCli.setConversationAwareness(nextState);
      await publishConversationAwarenessSubtitle(confirmedState, revision);
      await toast.setToSuccess({ titleOverride: conversationAwarenessHud(confirmedState) });
    } catch (error) {
      await publishConfirmedConversationAwareness(error, revision);
      if (error instanceof CliError && error.code === "unsupported") {
        await toast.setToFailure({
          titleOverride: "Conversation Awareness not supported",
          error: new Error("Your connected device doesn't support Conversation Awareness."),
        });
        return;
      }
      await showCliFailure(toast, error);
    }
  };

  await runWithSubtitleOperation("conversation-awareness", toast, run);
}
