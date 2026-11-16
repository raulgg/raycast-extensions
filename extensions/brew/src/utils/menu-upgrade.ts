/**
 * What a menu-bar click does before brew runs.
 *
 * The click prepares, writes one queued record, and launches the worker. It
 * does not wait for brew: the menu process is unloaded when the action
 * settles. A live run, or a prepare that declined, leaves no record and does
 * not launch.
 */

import type { UpgradePackage, UpgradeSummary } from "./brew/upgrade";
import {
  deleteUpgradeRun,
  queueRun,
  type UpgradeRunPackage,
  type UpgradeRunRecord,
  type UpgradeRunScope,
} from "./upgrade-run";

export type PrepareDecision = { status: "ready" } | { status: "skipped"; refresh?: boolean } | { status: "aborted" };

export interface MenuUpgradeClick {
  live: UpgradeRunRecord | undefined;
  scope: UpgradeRunScope;
  /** Omitted for Upgrade All. A one-package click always has one. */
  prepare?: PrepareDecision;
  selection: UpgradePackage[];
  packages: UpgradeRunPackage[];
  now?: number;
}

export interface MenuUpgradeResult {
  launched: boolean;
  /** The pin on disk disagreed with the row. The caller refreshes that snapshot. */
  refresh: boolean;
  hud?: string;
}

/** Only packages the run actually upgraded. Failed, skipped, and canceled-but-not-upgraded stay listed. */
export function packagesToForget(summary: UpgradeSummary): UpgradePackage[] {
  return summary.upgraded;
}

export async function queueMenuUpgrade(
  click: MenuUpgradeClick,
  launch: () => Promise<void>,
): Promise<MenuUpgradeResult> {
  if (click.live) {
    return { launched: false, refresh: false, hud: "An upgrade is already running" };
  }
  if (click.prepare && click.prepare.status !== "ready") {
    return {
      launched: false,
      refresh: click.prepare.status === "skipped" && click.prepare.refresh === true,
    };
  }

  const queued = await queueRun({
    scope: click.scope,
    selection: click.selection,
    packages: click.packages,
    now: click.now,
  });
  try {
    await launch();
  } catch {
    await deleteUpgradeRun(queued.id);
    return { launched: false, refresh: false, hud: "Could not start the upgrade" };
  }
  return { launched: true, refresh: false };
}
