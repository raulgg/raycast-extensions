import { getPreferenceValues, openCommandPreferences } from "@raycast/api";
import { LISTENING_MODE_PRESENTATION, listeningModeHud } from "../airpods/presentation";
import * as AirPodsControlCli from "../cli/client";
import { CliError } from "../cli/errors";
import { type SubtitleRevision } from "../commands/launch-context";
import { ToastManager } from "../feedback/toast-manager";
import { publishListeningModeSubtitle } from "../subtitles/feature-subtitles";
import { runWithSubtitleOperation, showCliFailure } from "./control-operation";
import { CYCLE_MODE_ORDER } from "./preferences";
import type { CycleCommandPreferences } from "./preferences";
import type { ListeningModes } from "../airpods/types";
interface SetListeningModeCommandOptions {
  updateCycleSubtitle: boolean;
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
