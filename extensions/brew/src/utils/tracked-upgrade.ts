/**
 * An in-view batch: the same record the menu-bar worker writes, owned by this
 * process for as long as brew runs. A live record refuses the start. The
 * worker does not use this — it already claimed the record the click queued.
 */

import { showHUD, showToast, Toast } from "@raycast/api";
import {
  upgradeKey,
  type UpgradeEvent,
  type UpgradeEventCallback,
  type UpgradePackage,
  type UpgradeSummary,
} from "./brew/upgrade";
import { isBackgroundLaunch } from "./toast";
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
import { runOutdatedUpgrade } from "./upgrade-runner";

const TICK_MS = 1000;

export async function runTrackedOutdatedUpgrade(options: {
  selection?: UpgradePackage[];
  controller: AbortController;
  onEvent?: UpgradeEventCallback;
}): Promise<UpgradeSummary | undefined> {
  if (await readLiveRun()) {
    await alreadyRunning();
    return undefined;
  }

  const selection = options.selection ?? [];
  const packages: UpgradeRunPackage[] = selection.map((pkg) => ({ ...pkg, status: "upgrading" }));
  const queued = await queueRun({ scope: "all", selection, packages });
  const owner = "in-view";
  const claimed = await claimRun(queued.id, owner);
  if (!claimed) return undefined;

  let chain: Promise<void> = Promise.resolve();
  const update = (mutate: (run: UpgradeRunRecord) => UpgradeRunRecord) => {
    chain = chain.then(async () => {
      const current = await readUpgradeRun();
      if (!current || current.id !== claimed.id || current.owner !== owner || current.phase !== "running") return;
      await writeUpgradeRun(mutate(current));
    });
    return chain;
  };

  const timer = setInterval(() => {
    void (async () => {
      if (await isCancelRequested(claimed.id)) options.controller.abort();
      await update((run) => ({ ...run, heartbeatAt: Date.now() }));
    })();
  }, TICK_MS);

  const onEvent = (event: UpgradeEvent) => {
    if (event.type === "package" && !(event.status === "upgrading" && event.progress)) {
      void update((run) => ({
        ...run,
        heartbeatAt: Date.now(),
        packages: run.packages.map((pkg) =>
          upgradeKey(pkg) === upgradeKey(event.package) ? { ...pkg, status: event.status } : pkg,
        ),
      }));
    }
    options.onEvent?.(event);
  };

  let phase: UpgradeRunRecord["phase"] = "failed";
  try {
    const summary = await runOutdatedUpgrade({
      selection: options.selection,
      signal: options.controller.signal,
      onEvent,
    });
    phase = summary.canceled ? "canceled" : summary.failed.length > 0 ? "failed" : "done";
    return summary;
  } finally {
    clearInterval(timer);
    chain = chain.then(async () => {
      const current = await readUpgradeRun();
      if (!current || current.id !== claimed.id || current.owner !== owner) return;
      await writeUpgradeRun({ ...current, phase, heartbeatAt: Date.now() });
    });
    await chain;
  }
}

async function alreadyRunning(): Promise<void> {
  if (isBackgroundLaunch()) {
    await showHUD("An upgrade is already running");
    return;
  }
  await showToast({ style: Toast.Style.Failure, title: "An upgrade is already running" });
}
