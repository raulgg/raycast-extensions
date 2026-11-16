/**
 * One outdated-package upgrade, shared by Show Upgrades and the background worker.
 *
 * The hook in `useBrewUpgrade` is the in-view adapter: it guards re-entry and
 * writes the row map. This function owns the toast script and the endings.
 * A background launch cannot show a toast — the cancel, partial-failure, and
 * abort endings use a HUD there, the same way `showActionToast` already does.
 */

import { showHUD, showToast, Toast } from "@raycast/api";
import {
  brewUpgradeOutdated,
  upgradeKey,
  type UpgradeEvent,
  type UpgradeEventCallback,
  type UpgradePackage,
  type UpgradeSummary,
} from "./brew/upgrade";
import { ensureError, isBrewLockError } from "./errors";
import { actionsLogger } from "./logger";
import { preferences } from "./preferences";
import { formatCount } from "./text";
import { forgetUpgraded } from "./outdated-removed";
import { copyLogsAction, isBackgroundLaunch, showActionToast, showBrewFailureToast } from "./toast";

const EMPTY_SUMMARY: UpgradeSummary = { upgraded: [], failed: [], skipped: [], canceled: false };

export async function runOutdatedUpgrade(options: {
  selection?: UpgradePackage[];
  signal?: AbortSignal;
  onEvent?: UpgradeEventCallback;
}): Promise<UpgradeSummary> {
  const toast = showActionToast({ title: "Upgrading", message: "Updating Homebrew…", cancelable: true });
  const cancel = linkAbortSignals(options.signal, toast.abort?.signal);

  let total = 0;
  let finished = 0;
  let inRun = new Set<string>();
  const removals: Promise<void>[] = [];

  const onEvent = (event: UpgradeEvent) => {
    switch (event.type) {
      case "update":
        toast.updateTitle("Upgrading");
        toast.updateMessage("Updating Homebrew…");
        break;
      case "check":
        toast.updateMessage("Checking for upgrades…");
        break;
      case "start":
        total = event.packages.length;
        // Pinned packages are reported as skipped but were filtered out before
        // the run, so they are not in this set — the counter only counts what
        // the run actually attempts.
        inRun = new Set(event.packages.map(upgradeKey));
        break;
      case "prefetch":
        toast.updateTitle(`Downloading ${formatCount(total, "package")}`);
        toast.updateMessage(event.progress?.message ?? "");
        break;
      case "package":
        if (event.status === "upgrading" && event.progress) {
          // Download lines stay on the toast. The row does not re-render per line.
          toast.updateMessage(event.progress.message);
        } else {
          if (event.status === "upgrading") {
            toast.updateTitle(`Upgrading ${event.package.name} (${finished + 1}/${total})`);
            toast.updateMessage("");
          } else if (inRun.has(upgradeKey(event.package))) {
            finished += 1;
          }
        }
        break;
    }
    // Record a finished package before the run returns, so a cancel keeps it.
    if (event.type === "package" && event.status === "upgraded") {
      removals.push(forgetUpgraded([event.package]));
    }
    options.onEvent?.(event);
  };

  try {
    const summary = await brewUpgradeOutdated({
      greedy: preferences.greedyUpgrades,
      cancel,
      selection: options.selection,
      onEvent,
    });
    await Promise.all(removals);

    if (summary.canceled) {
      toast.hide();
      await reportFailure("Upgrade Canceled", `${formatCount(summary.upgraded.length, "package")} upgraded`);
    } else if (summary.failed.length > 0) {
      // Keep the window open so the failed packages remain visible.
      toast.hide();
      const failedNames = summary.failed.map((pkg) => pkg.name).join(", ");
      const title = `Failed to upgrade ${formatCount(summary.failed.length, "package")}`;
      await reportFailure(title, failedNames, `${title}\n\n${failedNames}`);
    } else if (summary.upgraded.length === 0) {
      await toast.showSuccessHUD("Nothing to upgrade");
    } else {
      await toast.showSuccessHUD(`Upgraded ${formatCount(summary.upgraded.length, "package")}`);
    }
    return summary;
  } catch (err) {
    const error = ensureError(err);
    await Promise.all(removals);
    toast.hide();

    if (error.name === "AbortError") {
      actionsLogger.log("Upgrade canceled by user");
      await reportFailure("Upgrade Canceled");
      return { ...EMPTY_SUMMARY, canceled: true };
    }

    // The worker retries one lock on `brew update`. Reporting it here would
    // show a failure HUD for a run that is about to try again.
    if (isBrewLockError(error)) throw error;

    actionsLogger.error("Upgrade failed", { name: error.name, message: error.message });
    await showBrewFailureToast("Upgrade failed", error);
    return EMPTY_SUMMARY;
  }
}

/**
 * Brew watches one signal. The toast's Cancel and the caller's signal both
 * have to abort it: Show Upgrades cancels through the controller it owns, and
 * the toast's own button aborts a different controller.
 */
export function linkAbortSignals(
  external: AbortSignal | undefined,
  toastSignal: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!external) return toastSignal;
  if (!toastSignal) return external;
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  if (external.aborted || toastSignal.aborted) {
    abort();
  } else {
    external.addEventListener("abort", abort, { once: true });
    toastSignal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

async function reportFailure(title: string, message?: string, logs?: string): Promise<void> {
  if (isBackgroundLaunch()) {
    await showHUD(message ? `${title}. ${message}` : title);
    return;
  }
  await showToast({
    style: Toast.Style.Failure,
    title,
    message,
    primaryAction: logs ? copyLogsAction(logs, { hideToast: true }) : undefined,
  });
}
