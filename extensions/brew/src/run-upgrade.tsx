/**
 * Runs the upgrade a click queued.
 *
 * No interval: the menu bar's one-minute timer must not apply to a brew that
 * outlasts it. Opening this from search with nothing queued shows a HUD and
 * returns, so it is not a second Upgrade All.
 *
 * Imports stay specific. The utils barrel constructs caches at import time,
 * and this process must not rebuild them.
 */

import { launchCommand, LaunchType, showHUD } from "@raycast/api";
import { getErrorMessage, isBrewLockError } from "./utils/errors";
import { wait } from "./utils/async";
import { upgradeKey, type UpgradeEvent, type UpgradePackageStatus, type UpgradeSummary } from "./utils/brew/upgrade";
import { forgetUpgraded } from "./utils/outdated-removed";
import {
  claimRun,
  isCancelRequested,
  readUpgradeRun,
  writeUpgradeRun,
  type UpgradeRunPackage,
  type UpgradeRunRecord,
} from "./utils/upgrade-run";
import { runOutdatedUpgrade } from "./utils/upgrade-runner";
import { execUpgrade, upgradeTarget } from "./utils/upgrade-one";

const HEARTBEAT_MS = 1000;
const LOCK_RETRY_MS = 400;

export default async function Command(): Promise<void> {
  const queued = await readUpgradeRun();
  if (!queued || queued.phase !== "queued") {
    await showHUD("No upgrade is queued");
    return;
  }

  const owner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const claimed = await claimRun(queued.id, owner);
  if (!claimed) return;

  const controller = new AbortController();
  let chain: Promise<void> = Promise.resolve();
  const update = (mutate: (run: UpgradeRunRecord) => UpgradeRunRecord) => {
    chain = chain.then(async () => {
      const current = await readUpgradeRun();
      if (!current || current.id !== claimed.id || current.owner !== owner) return;
      if (current.phase !== "running") return;
      await writeUpgradeRun(mutate(current));
    });
    return chain;
  };

  const timer = setInterval(() => {
    void (async () => {
      if (await isCancelRequested(claimed.id)) controller.abort();
      await update((run) => ({ ...run, heartbeatAt: Date.now() }));
    })();
  }, HEARTBEAT_MS);

  let terminal = claimed;
  try {
    if (claimed.scope === "one") {
      terminal = await runOne(claimed, controller.signal);
    } else {
      terminal = await runAll(claimed, controller.signal, update);
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (isBrewLockError(error)) await showHUD("Brew is Busy");
    terminal = { ...claimed, phase: "failed", error: getErrorMessage(error), heartbeatAt: Date.now() };
  } finally {
    clearInterval(timer);
  }

  // Removal writes have already resolved: the one-package exec and the batch
  // runner both await them before returning. The terminal phase comes after.
  chain = chain.then(async () => {
    await writeUpgradeRun({ ...terminal, heartbeatAt: Date.now() });
  });
  await chain;

  try {
    await launchCommand({ name: "services-menu", type: LaunchType.Background });
  } catch {
    // A disabled menu bar cannot be launched. The next open reads this record.
  }
}

async function runOne(claimed: UpgradeRunRecord, signal: AbortSignal): Promise<UpgradeRunRecord> {
  const pkg = claimed.packages[0] ?? {
    name: claimed.selection[0]?.name ?? "",
    isCask: claimed.selection[0]?.isCask ?? false,
  };
  const result = await execUpgrade(upgradeTarget(pkg), signal, { track: false });
  const status: UpgradePackageStatus = result === "upgraded" ? "upgraded" : result === "skipped" ? "skipped" : "failed";
  return {
    ...claimed,
    phase: signal.aborted ? "canceled" : result === "failed" ? "failed" : "done",
    heartbeatAt: Date.now(),
    packages: claimed.packages.map((row, index) => (index === 0 ? { ...row, status } : row)),
  };
}

async function runAll(
  claimed: UpgradeRunRecord,
  signal: AbortSignal,
  update: (mutate: (run: UpgradeRunRecord) => UpgradeRunRecord) => Promise<void>,
): Promise<UpgradeRunRecord> {
  const once = () =>
    runOutdatedUpgrade({
      selection: claimed.selection,
      signal,
      onEvent: (event) => {
        void notePackage(event, update);
      },
    });

  let summary: UpgradeSummary;
  try {
    summary = await once();
  } catch (err) {
    if (!isBrewLockError(err)) throw err;
    await wait(LOCK_RETRY_MS);
    summary = await once();
  }

  return {
    ...claimed,
    phase: summary.canceled ? "canceled" : summary.failed.length > 0 ? "failed" : "done",
    heartbeatAt: Date.now(),
    packages: withSummary(claimed.packages, summary),
  };
}

async function notePackage(
  event: UpgradeEvent,
  update: (mutate: (run: UpgradeRunRecord) => UpgradeRunRecord) => Promise<void>,
): Promise<void> {
  if (event.type !== "package") return;
  if (event.status === "upgrading" && event.progress) return;
  await update((run) => ({
    ...run,
    heartbeatAt: Date.now(),
    packages: run.packages.map((pkg) =>
      pkg.name === event.package.name && pkg.isCask === event.package.isCask ? { ...pkg, status: event.status } : pkg,
    ),
  }));
  if (event.status === "upgraded") await forgetUpgraded([event.package]);
}

function withSummary(packages: UpgradeRunPackage[], summary: UpgradeSummary): UpgradeRunPackage[] {
  const statusOf = new Map<string, UpgradePackageStatus>();
  for (const pkg of summary.upgraded) statusOf.set(upgradeKey(pkg), "upgraded");
  for (const pkg of summary.failed) statusOf.set(upgradeKey(pkg), "failed");
  for (const pkg of summary.skipped) statusOf.set(upgradeKey(pkg), "skipped");
  return packages.map((pkg) => {
    const status = statusOf.get(upgradeKey(pkg));
    return status ? { ...pkg, status } : pkg;
  });
}
