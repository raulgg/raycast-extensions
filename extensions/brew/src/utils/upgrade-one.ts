/**
 * The brew half of a one-package upgrade.
 *
 * Trust and the pin check happen before this, in the click. A background
 * worker cannot ask again: Alert throws there, and `ensureTrusted` would
 * refuse. This function runs `brew upgrade`, decides a declined exit 0, and
 * reports through the HUD when the launch is in the background.
 *
 * In-view callers publish the shared run record. The worker passes
 * `track: false` because it already owns the record the click queued.
 */

import { showHUD, showToast, Toast } from "@raycast/api";
import { brewUpgradeSingleWithProgress } from "./brew/actions";
import { brewIdentifier, brewName, isCask } from "./brew/helpers";
import { ensureError, upgradeSkipReason } from "./errors";
import { forgetUpgraded } from "./outdated-removed";
import { copyLogsAction, isBackgroundLaunch, showActionToast, showBrewFailureToast } from "./toast";
import type { Cask, Nameable } from "./types";
import { linkAbortSignals } from "./upgrade-runner";
import {
  claimRun,
  isCancelRequested,
  queueRun,
  readLiveRun,
  readUpgradeRun,
  writeUpgradeRun,
  type UpgradeRunPackage,
  type UpgradeRunRecord,
} from "./upgrade-run";

export type OneUpgradeResult = "upgraded" | "skipped" | "failed" | "aborted";

const TICK_MS = 1000;

export async function execUpgrade(
  item: Cask | Nameable,
  signal?: AbortSignal,
  options?: { track?: boolean },
): Promise<OneUpgradeResult> {
  const track = options?.track !== false;
  const cask = isCask(item);
  const packageName = cask ? item.token : brewIdentifier(item);
  let claimed: UpgradeRunRecord | undefined;
  if (track) {
    if (await readLiveRun()) {
      if (isBackgroundLaunch()) await showHUD("An upgrade is already running");
      else await showToast({ style: Toast.Style.Failure, title: "An upgrade is already running" });
      return "aborted";
    }
    const queued = await queueRun({
      scope: "one",
      selection: [{ name: packageName, isCask: cask }],
      packages: [{ name: packageName, isCask: cask, status: "upgrading" }],
    });
    claimed = await claimRun(queued.id, "in-view");
    if (!claimed) return "aborted";
  }

  const name = brewName(item);
  const handle = showActionToast({
    title: `Upgrading ${name}`,
    message: "",
    cancelable: true,
  });
  const cancel = linkAbortSignals(signal, handle.abort?.signal);
  const timer =
    claimed &&
    setInterval(() => {
      const runId = claimed?.id;
      if (!runId) return;
      void (async () => {
        if (await isCancelRequested(runId)) handle.abort?.abort();
        const current = await readUpgradeRun();
        if (!current || current.id !== runId || current.phase !== "running") return;
        await writeUpgradeRun({ ...current, heartbeatAt: Date.now() });
      })();
    }, TICK_MS);

  let outcome: OneUpgradeResult = "failed";
  try {
    const result = await brewUpgradeSingleWithProgress(
      item,
      (progress) => {
        handle.updateMessage(progress.message);
      },
      cancel,
    );

    // Exit 0 is not proof of an upgrade — brew warns and skips a disabled,
    // unavailable or already-current package.
    const declined = upgradeSkipReason(`${result.stderr ?? ""}\n${result.stdout ?? ""}`, brewIdentifier(item));
    if (declined) {
      await handle.hide();
      if (isBackgroundLaunch()) {
        await showHUD(`Did not upgrade ${name}. ${declined}`);
      } else {
        await showToast({
          style: Toast.Style.Failure,
          title: `Did not upgrade ${name}`,
          message: declined,
          primaryAction: copyLogsAction(`Did not upgrade ${name}\n\n${declined}`, { hideToast: true }),
        });
      }
      outcome = "skipped";
      return outcome;
    }

    await handle.showSuccessHUD(`Upgraded ${name}`);
    // A bare `brew upgrade` exit code removes nothing. This path knows the
    // one package that finished, so only that package leaves the lists.
    await forgetUpgraded([item]);
    outcome = "upgraded";
    return outcome;
  } catch (err) {
    const error = ensureError(err);
    await handle.showFailureHUD(`Failed to upgrade ${name}`);
    showBrewFailureToast("Upgrade failed", error);
    outcome = "failed";
    return outcome;
  } finally {
    if (timer) clearInterval(timer);
    if (claimed) {
      const current = await readUpgradeRun();
      if (current && current.id === claimed.id && current.owner === "in-view") {
        const phase = handle.abort?.signal.aborted ? "canceled" : outcome === "failed" ? "failed" : "done";
        const status = outcome === "upgraded" ? "upgraded" : outcome === "skipped" ? "skipped" : "failed";
        await writeUpgradeRun({
          ...current,
          phase,
          heartbeatAt: Date.now(),
          packages: current.packages.map((pkg) => ({ ...pkg, status })),
        });
      }
    }
  }
}

/**
 * Rebuild the package the worker should pass to brew. An outdated cask's name
 * is its token; a formula's name is already the identifier brew wants.
 */
export function upgradeTarget(pkg: UpgradeRunPackage): Cask | Nameable {
  if (pkg.isCask) {
    return { name: pkg.name, token: pkg.name } as unknown as Cask;
  }
  return { name: pkg.name };
}
