/**
 * Menu-bar upgrade list.
 *
 * Paints from the cached snapshot immediately, and fetches only when that
 * snapshot is missing, was taken under a different Greedy Upgrades setting,
 * or the last check — success or failure — is at least 1 hour old. No toast
 * and no HUD: a background launch throws on toast, and the refresh itself is
 * supposed to stay quiet.
 */

import { useCallback, useEffect, useState } from "react";
import { loadMenuBarUpgrades, peekMenuBarUpgrades, type MenuBarUpgradesLoad } from "../utils/menu-bar-upgrades";
import { readRemoved, subscribeRemoved, subtractRemoved } from "../utils/outdated-removed";
import { clearFinishedRun, readLiveRun, readUpgradeRun, type UpgradeRunRecord } from "../utils/upgrade-run";
import type { OutdatedResults } from "../utils/types";

interface MenuBarUpgradesState {
  isLoading: boolean;
  data?: OutdatedResults;
  error?: Error;
  /** Fetch start of `data`, so a later removal can be compared without refetching. */
  startedAt?: number;
  liveRun?: UpgradeRunRecord;
}

export function useMenuBarUpgrades(enabled: boolean, greedy: boolean) {
  const [state, setState] = useState<MenuBarUpgradesState>(() => initialState(enabled, greedy));

  const apply = useCallback((outcome: MenuBarUpgradesLoad) => {
    if (outcome.status === "disabled") {
      setState({ isLoading: false });
      return;
    }
    if (outcome.status === "failed") {
      setState({ isLoading: false, data: outcome.results, error: outcome.error, startedAt: outcome.startedAt });
      return;
    }
    setState({ isLoading: false, data: outcome.results, startedAt: outcome.startedAt });
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ isLoading: false });
      return;
    }
    let cancelled = false;
    void (async () => {
      const live = await readLiveRun();
      const removed = await readRemoved();
      if (cancelled) return;
      if (!live) {
        const stored = await readUpgradeRun();
        if (stored && stored.phase !== "queued" && stored.phase !== "running") await clearFinishedRun();
      }
      if (cancelled) return;
      if (live) {
        // A live run holds Homebrew's lock. Paint the snapshot we already
        // have, minus packages that finished, and do not call brew.
        const peeked = peekMenuBarUpgrades(greedy);
        const data =
          peeked.results && peeked.startedAt !== undefined
            ? subtractRemoved(peeked.results, removed, peeked.startedAt)
            : peeked.results;
        setState({ isLoading: false, data, error: peeked.error, startedAt: peeked.startedAt, liveRun: live });
        return;
      }
      const outcome = await loadMenuBarUpgrades({ enabled: true, greedy });
      if (!cancelled) apply(outcome);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, greedy, apply]);

  // A removal written in this process (the click is still this command, until
  // the worker owns brew) drops that package without another `brew outdated`.
  useEffect(() => {
    return subscribeRemoved(() => {
      void readRemoved().then((removed) => {
        setState((current) => {
          if (!current.data || current.startedAt === undefined) return current;
          return { ...current, data: subtractRemoved(current.data, removed, current.startedAt) };
        });
      });
    });
  }, []);

  const refresh = useCallback(() => {
    setState((current) => ({ ...current, isLoading: true }));
    return loadMenuBarUpgrades({ enabled: true, greedy, force: true }).then(apply);
  }, [greedy, apply]);

  return { ...state, refresh };
}

function initialState(enabled: boolean, greedy: boolean): MenuBarUpgradesState {
  if (!enabled) {
    return { isLoading: false };
  }
  const peeked = peekMenuBarUpgrades(greedy);
  // Stay loading until the removal read is applied, even when the snapshot is
  // fresh. The menu bar unloads as soon as loading flips to false, which would
  // cancel that read, and clearing the peeked list would blink the arrow off
  // the title for the length of it. The peeked count stays up meanwhile.
  return { isLoading: true, data: peeked.results, error: peeked.error };
}
