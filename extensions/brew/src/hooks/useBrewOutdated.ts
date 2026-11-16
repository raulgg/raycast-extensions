/**
 * Hook for fetching outdated brew packages.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { showToast, Toast } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import {
  brewFetchOutdated,
  brewUpdate,
  normalizeOutdatedResults,
  OutdatedResults,
  isBrewLockError,
  brewLogger,
  copyLogsAction,
  getErrorMessage,
} from "../utils";
import { preferences, outdatedFetchFailureCopy } from "../utils";
import { readRemoved, subscribeRemoved, subtractRemoved } from "../utils/outdated-removed";
import { clearFinishedRun, readLiveRun, readUpgradeRun, type UpgradeRunRecord } from "../utils/upgrade-run";

/**
 * Hook to fetch and cache outdated brew packages.
 *
 * Uses a two-phase fetch strategy for faster initial load:
 * 1. First, fetch outdated packages WITHOUT running brew update (fast, ~1s)
 * 2. Then, run brew update in background and refresh (slower, ~5-10s)
 *
 * This shows potentially stale data immediately, then updates with fresh data.
 *
 * @param options.backgroundRefresh - Set false to skip phase 2. The Upgrade
 * command must: its run engine issues its own `brew update` the moment data
 * arrives, and Homebrew refuses concurrent updates — the two processes would
 * race for the update lock and whichever loses errors out.
 * @returns Object containing loading state, data, isRefreshing flag, and revalidate function
 */
export function useBrewOutdated(options?: { backgroundRefresh?: boolean }) {
  const backgroundRefresh = options?.backgroundRefresh ?? true;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hasRefreshedRef = useRef(false);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const [removed, setRemoved] = useState<Map<string, number> | undefined>(undefined);
  const [watch, setWatch] = useState<{ ready: boolean; liveRun?: UpgradeRunRecord; signature: string }>({
    ready: false,
    signature: "",
  });
  // "pending" until the first read. "on" fetches. "off" after a live run, so
  // the run ending does not start another `brew outdated`.
  const [fetchMode, setFetchMode] = useState<"pending" | "on" | "off">("pending");

  useEffect(() => {
    if (!watch.ready) return;
    setFetchMode((mode) => {
      if (watch.liveRun) return "off";
      if (mode === "pending") return "on";
      return mode;
    });
  }, [watch.ready, watch.liveRun]);

  // One poll for the run record and the removal keys. setState only when the
  // text changed, so a quiet second does not re-render the list.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const [run, live, removedNow] = await Promise.all([readUpgradeRun(), readLiveRun(), readRemoved()]);
      if (cancelled) return;
      if (run && run.phase !== "queued" && run.phase !== "running") await clearFinishedRun();
      const signature = `${live ? JSON.stringify(live) : ""}\n${removedSignature(removedNow)}`;
      setWatch((current) =>
        current.ready && current.signature === signature ? current : { ready: true, liveRun: live, signature },
      );
      setRemoved((current) =>
        current && removedSignature(current) === removedSignature(removedNow) ? current : removedNow,
      );
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // The removal record is what hides a package that already upgraded. Read it
  // before the first paint, and again when this process writes another key.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void readRemoved().then((map) => {
        if (!cancelled) setRemoved(map);
      });
    };
    load();
    const unsubscribe = subscribeRemoved(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const result = useCachedPromise(
    async (): Promise<OutdatedResults & { startedAt: number }> => {
      // Taken before the fetch. A removal is hidden only when it is later
      // than this, so an in-flight read cannot put an upgraded package back.
      const startedAt = Date.now();
      // On first load, skip update for speed
      // The background refresh will update the data
      const fresh = await brewFetchOutdated(preferences.greedyUpgrades, undefined, true);
      return { ...fresh, startedAt };
    },
    [],
    {
      keepPreviousData: true,
      execute: fetchMode === "on",
      onError: async (error) => {
        brewLogger.error("Failed to fetch outdated packages", {
          errorType: error.name,
          message: error.message,
          isLockError: isBrewLockError(error),
        });

        // With nothing cached (or only a cached empty result), the command
        // renders a full-screen failure view (OutdatedErrorView) with its own
        // Retry — a toast on top of it would just duplicate the message.
        // Toast only when cached packages are actually on screen and the
        // toast is the sole failure signal.
        const hasCachedPackages =
          result.data !== undefined && (result.data.formulae.length > 0 || result.data.casks.length > 0);
        if (!hasCachedPackages) return;

        const copy = outdatedFetchFailureCopy(error);

        await showToast({
          style: Toast.Style.Failure,
          title: copy.title,
          message: copy.message,
          primaryAction: {
            title: "Retry",
            onAction: (toast) => {
              toast.hide();
              result.revalidate();
            },
          },
          secondaryAction: copyLogsAction(getErrorMessage(error), { hideToast: true }),
        });
      },
    },
  );

  // Background refresh: run brew update then fetch fresh outdated data
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const refreshInBackground = useCallback(() => {
    if (hasRefreshedRef.current || result.isLoading) return;
    hasRefreshedRef.current = true;
    setIsRefreshing(true);
    const controller = new AbortController();
    refreshAbortRef.current = controller;

    brewLogger.log("Starting background refresh for outdated packages");

    // Tracked so cancelRefresh can await the actual process exit — an
    // aborted `brew update` may hold Homebrew's lock for a moment after the
    // signal flips, and a run started before it dies loses the lock race.
    refreshPromiseRef.current = (async () => {
      try {
        // Run brew update (loading indicator is shown via isRefreshing)
        await brewUpdate(controller.signal);

        // Then fetch fresh outdated data (skipUpdate since we just did it)
        const freshData = await brewFetchOutdated(preferences.greedyUpgrades, controller.signal, true);

        // Only update if we got different results
        if (
          freshData.formulae.length !== result.data?.formulae.length ||
          freshData.casks.length !== result.data?.casks.length
        ) {
          brewLogger.log("Background refresh found changes", {
            oldFormulae: result.data?.formulae.length ?? 0,
            newFormulae: freshData.formulae.length,
            oldCasks: result.data?.casks.length ?? 0,
            newCasks: freshData.casks.length,
          });
          // Trigger a revalidate to update the UI with fresh data
          result.revalidate();
        } else {
          brewLogger.log("Background refresh complete, no changes");
        }
      } catch (error) {
        if (controller.signal.aborted) {
          brewLogger.log("Background refresh canceled");
        } else {
          brewLogger.warn("Background refresh failed", { error });
        }
      } finally {
        refreshAbortRef.current = null;
        refreshPromiseRef.current = null;
        setIsRefreshing(false);
      }
    })();
  }, [result]);

  // Abort an in-flight background refresh and wait for its process to exit.
  // Show Upgrades awaits this before starting a run: the run engine issues
  // its own `brew update`, Homebrew refuses concurrent updates, and the
  // aborted update may hold the lock for a moment after the signal flips.
  const cancelRefresh = useCallback(async () => {
    refreshAbortRef.current?.abort();
    await refreshPromiseRef.current;
  }, []);

  // A run that starts while `brew update` is in flight has to take the lock.
  useEffect(() => {
    if (watch.liveRun) void cancelRefresh();
  }, [watch.liveRun, cancelRefresh]);

  // Start background refresh after initial data loads. Not on a failed
  // initial fetch: internally cached data still exists then, but the screen
  // is showing the failure view — kicking off a long `brew update` would bury
  // that behind a checking spinner; Retry is the recovery path instead.
  useEffect(() => {
    if (
      backgroundRefresh &&
      !watch.liveRun &&
      !result.isLoading &&
      result.data &&
      !result.error &&
      !hasRefreshedRef.current
    ) {
      refreshInBackground();
    }
  }, [backgroundRefresh, watch.liveRun, result.isLoading, result.data, result.error, refreshInBackground]);

  // Abort an in-flight background `brew update` when the command unmounts —
  // left running, it can race the next command's own update for Homebrew's
  // update lock.
  useEffect(() => {
    return () => {
      refreshAbortRef.current?.abort();
    };
  }, []);

  const removalsReady = removed !== undefined;
  const normalized = result.data ? normalizeOutdatedResults(result.data) : undefined;
  const startedAt = startedAtOf(normalized);
  const visible =
    normalized && removed && startedAt !== undefined ? subtractRemoved(normalized, removed, startedAt) : normalized;
  return {
    ...result,
    // `useCachedPromise` persists between command runs, so `data` can be a
    // snapshot written before outdated casks carried a `token` — without which
    // every brew argv built from these rows loses its `--cask`. Normalizing on
    // read migrates those in place; it is idempotent for fresh data.
    // Hold the list until the removal record has been read, so a package that
    // already upgraded is not painted and then removed.
    data: removalsReady ? visible : undefined,
    isLoading: result.isLoading || !removalsReady,
    isRefreshing,
    cancelRefresh,
    liveRun: watch.liveRun,
  };
}

function removedSignature(removed: Map<string, number>): string {
  return [...removed.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, at]) => `${key}=${at}`)
    .join("|");
}

function startedAtOf(data: OutdatedResults | undefined): number | undefined {
  const value = (data as { startedAt?: unknown } | undefined)?.startedAt;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
