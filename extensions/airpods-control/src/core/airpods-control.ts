import { getPreferenceValues, openCommandPreferences } from "@raycast/api";
import * as AirPodsControlCli from "./airpods-control-cli";
import { CliError } from "./cli";
import { publishCommandSubtitle, resetCommandSubtitle } from "./command-metadata";
import { CYCLE_MODE_ORDER } from "./consts";
import {
  conversationAwarenessHud,
  conversationAwarenessSubtitle,
  LISTENING_MODE_PRESENTATION,
  listeningModeHud,
  listeningModeSubtitle,
} from "./presentation";
import { ToastManager } from "./toast-manager";
import type { ConversationAwarenessState, CycleCommandPreferences, ListeningModes } from "./types";

const OFF_NOT_APPLIED_HINT =
  "macOS did not confirm Off after the requested change. Off may be disabled in your AirPods noise-control settings; " +
  "if so, uncheck Off in the Cycle Listening Mode preferences and disable the Disable Noise Control command.";

interface SetListeningModeCommandOptions {
  updateCycleSubtitle: boolean;
}

async function refreshCommandSubtitle<State>(
  readState: () => Promise<State>,
  publishState: (state: State | null) => Promise<void>,
): Promise<void> {
  try {
    await publishState(await readState());
  } catch {
    await publishState(null);
  }
}

export async function publishListeningModeSubtitle(mode: ListeningModes | null): Promise<void> {
  if (mode) {
    await publishCommandSubtitle(listeningModeSubtitle(mode));
  } else {
    await resetCommandSubtitle();
  }
}

export async function publishConversationAwarenessSubtitle(state: ConversationAwarenessState | null): Promise<void> {
  if (state) {
    await publishCommandSubtitle(conversationAwarenessSubtitle(state));
  } else {
    await resetCommandSubtitle();
  }
}

export async function refreshListeningModeSubtitle(): Promise<void> {
  await refreshCommandSubtitle(AirPodsControlCli.getListeningMode, publishListeningModeSubtitle);
}

export async function refreshConversationAwarenessSubtitle(): Promise<void> {
  await refreshCommandSubtitle(AirPodsControlCli.getConversationAwareness, publishConversationAwarenessSubtitle);
}

async function publishConfirmedListeningMode(error: unknown, enabled: boolean): Promise<void> {
  if (!enabled) return;

  const mode = error instanceof CliError ? AirPodsControlCli.confirmedListeningMode(error.payload) : null;
  if (mode) {
    await publishCommandSubtitle(listeningModeSubtitle(mode));
  } else {
    await resetCommandSubtitle();
  }
}

async function publishConfirmedConversationAwareness(error: unknown): Promise<void> {
  const state = error instanceof CliError ? AirPodsControlCli.confirmedConversationAwareness(error.payload) : null;
  if (state) {
    await publishCommandSubtitle(conversationAwarenessSubtitle(state));
  } else {
    await resetCommandSubtitle();
  }
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

  if (updateCycleSubtitle) {
    await publishCommandSubtitle(listeningModeSubtitle(modeToActivate));
  }

  try {
    const confirmedMode = await AirPodsControlCli.setListeningMode(modeToActivate);
    if (updateCycleSubtitle && confirmedMode !== modeToActivate) {
      await publishCommandSubtitle(listeningModeSubtitle(confirmedMode));
    }
    await toast.setToSuccess({ titleOverride: listeningModeHud(confirmedMode) });
  } catch (error) {
    await publishConfirmedListeningMode(error, updateCycleSubtitle);
    await showCliFailure(toast, error, { offRequested: modeToActivate === "off" });
  }
}

function nextCycleMode(currentMode: ListeningModes, cycleModes: ListeningModes[]): ListeningModes {
  const currentIndex = CYCLE_MODE_ORDER.indexOf(currentMode);
  for (let offset = 1; offset <= CYCLE_MODE_ORDER.length; offset += 1) {
    const candidate = CYCLE_MODE_ORDER[(currentIndex + offset) % CYCLE_MODE_ORDER.length];
    if (cycleModes.includes(candidate)) {
      return candidate;
    }
  }
  return cycleModes[0];
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

  try {
    const currentMode = await AirPodsControlCli.getListeningMode();
    const expectedMode = nextCycleMode(currentMode, selectedModes);
    await publishCommandSubtitle(listeningModeSubtitle(expectedMode));
    const confirmedMode = await AirPodsControlCli.cycleListeningMode(selectedModes);
    if (confirmedMode !== expectedMode) {
      await publishCommandSubtitle(listeningModeSubtitle(confirmedMode));
    }
    await toast.setToSuccess({
      titleOverride: listeningModeHud(confirmedMode),
    });
  } catch (error) {
    await publishConfirmedListeningMode(error, true);
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
}

export async function runToggleConversationAwarenessCommand(): Promise<void> {
  const toast = new ToastManager({
    loading: "Toggling Conversation Awareness...",
    success: "Toggled Conversation Awareness",
    failure: "Failed to toggle Conversation Awareness",
  });
  await toast.setToLoading();

  try {
    const currentState = await AirPodsControlCli.getConversationAwareness();
    const nextState: ConversationAwarenessState = currentState === "on" ? "off" : "on";
    await publishCommandSubtitle(conversationAwarenessSubtitle(nextState));
    const confirmedState = await AirPodsControlCli.setConversationAwareness(nextState);
    if (confirmedState !== nextState) {
      await publishCommandSubtitle(conversationAwarenessSubtitle(confirmedState));
    }
    await toast.setToSuccess({ titleOverride: conversationAwarenessHud(confirmedState) });
  } catch (error) {
    await publishConfirmedConversationAwareness(error);
    if (error instanceof CliError && error.code === "unsupported") {
      await toast.setToFailure({
        titleOverride: "Conversation Awareness not supported",
        error: new Error("Your connected device doesn't support Conversation Awareness."),
      });
      return;
    }
    await showCliFailure(toast, error);
  }
}
