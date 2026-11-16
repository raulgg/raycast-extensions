/**
 * Hook for upgrading all outdated packages.
 *
 * Progress is reported via the toast/HUD. The per-package status is exposed so
 * that a list can show it, e.g. as the icon of each item.
 */

import { useCallback, useRef, useState } from "react";
import {
  actionsLogger,
  ensureError,
  isBrewLockError,
  showBrewFailureToast,
  upgradeKey,
  type OutdatedResults,
  type UpgradePackage,
  type UpgradePackageStatus,
} from "../utils";
import { showHUD, showToast, Toast } from "@raycast/api";
import { isBackgroundLaunch } from "../utils/toast";
import { readLiveRun } from "../utils/upgrade-run";
import { runTrackedOutdatedUpgrade } from "../utils/tracked-upgrade";

/** Upgrade status of a package. */
export interface PackageState {
  status: UpgradePackageStatus;
  message?: string;
}

export interface BrewUpgrade {
  /** Upgrade status of each package, keyed by `upgradeKey` */
  states: Map<string, PackageState>;
  /** Outdated packages, as fetched when the upgrade started */
  outdated?: OutdatedResults;
  isUpgrading: boolean;
  /**
   * Upgrade the outdated packages, restricted to `selection` when given.
   * Does nothing if an upgrade is already running.
   */
  upgradeAll: (selection?: UpgradePackage[]) => Promise<void>;
  /** Set the status of a single package, e.g. when upgraded individually */
  setPackageState: (pkg: UpgradePackage, state: PackageState) => void;
  /** Cancel the running upgrade */
  cancel: () => void;
  /** Clear the upgrade status of all packages */
  reset: () => void;
}

export function useBrewUpgrade(): BrewUpgrade {
  const [states, setStates] = useState<Map<string, PackageState>>(new Map());
  const [outdated, setOutdated] = useState<OutdatedResults | undefined>();
  const [isUpgrading, setIsUpgrading] = useState(false);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const isUpgradingRef = useRef(false);

  const setState = useCallback((key: string, state: PackageState) => {
    setStates((previous) => {
      const existing = previous.get(key);
      if (existing?.status === state.status && existing?.message === state.message) {
        return previous;
      }
      const next = new Map(previous);
      next.set(key, state);
      return next;
    });
  }, []);

  const setPackageState = useCallback(
    (pkg: UpgradePackage, state: PackageState) => setState(upgradeKey(pkg), state),
    [setState],
  );

  const upgradeAll = useCallback(
    async (selection?: UpgradePackage[]) => {
      // Homebrew does not support concurrent upgrades
      if (isUpgradingRef.current) {
        actionsLogger.log("Upgrade already running, skipping duplicate call");
        return;
      }
      if (await readLiveRun()) {
        if (isBackgroundLaunch()) {
          await showHUD("An upgrade is already running");
        } else {
          await showToast({ style: Toast.Style.Failure, title: "An upgrade is already running" });
        }
        return;
      }
      isUpgradingRef.current = true;
      setIsUpgrading(true);

      actionsLogger.log("Starting upgrade process");

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // The runner owns the toast script. This callback only writes the row map.
        await runTrackedOutdatedUpgrade({
          selection,
          controller,
          onEvent: (event) => {
            if (event.type === "start") {
              setOutdated(event.outdated);
              return;
            }
            if (event.type !== "package") return;
            if (event.status === "upgrading" && event.progress) return;
            setState(upgradeKey(event.package), { status: event.status, message: event.message });
          },
        });
      } catch (err) {
        if (isBrewLockError(err)) {
          await showBrewFailureToast("Upgrade failed", ensureError(err));
        }
      } finally {
        isUpgradingRef.current = false;
        setIsUpgrading(false);
      }
    },
    [setState],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    setStates(new Map());
    setOutdated(undefined);
  }, []);

  return { states, outdated, isUpgrading, upgradeAll, setPackageState, cancel, reset };
}
