/**
 * Menu-bar upgrade list.
 *
 * Paints from the cached snapshot immediately, and fetches only when that
 * snapshot is missing, was taken under a different Greedy Upgrades setting,
 * or the last check — success or failure — is at least 6 hours old. No toast
 * and no HUD: a background launch throws on toast, and the refresh itself is
 * supposed to stay quiet.
 */

import { useCallback, useEffect, useState } from "react";
import { loadMenuBarUpgrades, peekMenuBarUpgrades, type MenuBarUpgradesLoad } from "../utils/menu-bar-upgrades";
import type { OutdatedResults } from "../utils/types";

interface MenuBarUpgradesState {
  isLoading: boolean;
  data?: OutdatedResults;
  error?: Error;
}

export function useMenuBarUpgrades(enabled: boolean, greedy: boolean) {
  const [state, setState] = useState<MenuBarUpgradesState>(() => initialState(enabled, greedy));

  const apply = useCallback((outcome: MenuBarUpgradesLoad) => {
    if (outcome.status === "disabled") {
      setState({ isLoading: false });
      return;
    }
    if (outcome.status === "failed") {
      setState({ isLoading: false, data: outcome.results, error: outcome.error });
      return;
    }
    setState({ isLoading: false, data: outcome.results });
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ isLoading: false });
      return;
    }
    let cancelled = false;
    void loadMenuBarUpgrades({ enabled: true, greedy }).then((outcome) => {
      if (!cancelled) {
        apply(outcome);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, greedy, apply]);

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
  // `isLoading` has to be true on the first render when a fetch is required.
  // The menu bar unloads as soon as it flips to false, which would cancel a
  // fetch that started in an effect after a first paint of false.
  return { isLoading: !peeked.fresh, data: peeked.results, error: peeked.error };
}
