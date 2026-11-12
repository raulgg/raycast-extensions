/**
 * Upgrade count for the services menu bar.
 *
 * That command relaunches about once a minute so service state stays current.
 * `brew outdated` does not: it is only as fresh as the last `brew update`, and
 * running it on every tick would spend that cost on a number that rarely
 * changes. The list and the time of the last check are kept and reused until
 * they are 1 hour old, including a check that failed — otherwise the
 * one-minute service tick would run `brew outdated` on every launch.
 * "Refresh upgrades" passes `force` and fetches immediately.
 *
 * This path never runs `brew update`. It calls `brewFetchOutdated` with
 * `skipUpdate`, which sets `HOMEBREW_NO_AUTO_UPDATE` so Homebrew does not
 * perform one on its own before the outdated read.
 *
 * The snapshot records whether it was fetched with Greedy Upgrades. Show
 * Upgrades uses that same preference, so a list cached under the other setting
 * is not the count the menu should show.
 */

import { Cache } from "@raycast/api";
import { BrewLockError, ensureError, getErrorMessage, isBrewLockError } from "./errors";
import { brewFetchOutdated } from "./brew/fetch";
import { normalizeOutdatedResults } from "./brew/helpers";
import { brewLogger } from "./logger";
import { formatCount } from "./text";
import type { OutdatedResults } from "./types";

/** Reuse a fetched list until it is this old. A forced refresh ignores it. */
const MAX_AGE_MS = 1 * 60 * 60 * 1000;

export const MENU_BAR_UPGRADES_CACHE_NAMESPACE = "services-menu";
export const MENU_BAR_UPGRADES_CACHE_KEY = "upgrades";

const cache = new Cache({ namespace: MENU_BAR_UPGRADES_CACHE_NAMESPACE });

interface StoredFailure {
  lock: boolean;
  message: string;
}

interface Snapshot {
  /** When the last check ran, whether it succeeded or not. */
  attemptedAt: number;
  greedy: boolean;
  /** Absent when a check has never succeeded. Never an empty stand-in for a failure. */
  results?: OutdatedResults;
  failure?: StoredFailure;
}

export type MenuBarUpgradesLoad =
  | { status: "disabled" }
  | { status: "cached" | "fetched"; results: OutdatedResults; fetchedAt: number }
  | { status: "failed"; error: Error; results?: OutdatedResults; fetchedAt?: number };

export interface LoadMenuBarUpgradesOptions {
  /** Command preference. When false, nothing here runs `brew`. */
  enabled: boolean;
  /** Extension preference `greedyUpgrades`, the same one Show Upgrades reads. */
  greedy: boolean;
  /** "Refresh upgrades" — fetch even when the cached list is still fresh. */
  force?: boolean;
  /** Clock for tests. Defaults to `Date.now()`. */
  now?: number;
}

const inflight = new Map<string, Promise<MenuBarUpgradesLoad>>();

/**
 * The running-service count stays a plain number. The upgrade count is the one
 * with the arrow, and only when it is above zero: `2 ↑3`. At zero upgrades
 * the title is just the service count, and at zero services it stays empty —
 * unless upgrades are waiting, in which case the service count is shown as 0
 * so the arrow is never the only number.
 */
export function menuBarTitle(runningServices: number, upgradeCount: number | undefined): string | undefined {
  if (upgradeCount !== undefined && upgradeCount > 0) {
    return `${runningServices} \u2191${upgradeCount}`;
  }
  return runningServices > 0 ? `${runningServices}` : undefined;
}

/** "Homebrew Services" until there is an upgrade count to name. */
export function menuBarTooltip(runningServices: number, upgradeCount: number | undefined): string {
  if (upgradeCount === undefined || upgradeCount <= 0) {
    return "Homebrew Services";
  }
  return `${formatCount(runningServices, "service")} running \u00b7 ${formatCount(upgradeCount, "upgrade")}`;
}

/**
 * Upgrades section title. The count is on the title when it is above zero
 * (`Upgrades · 3 outdated`). At zero the title is just `Upgrades` and the section's
 * only row is "Up to date".
 */
export function menuBarUpgradesSectionTitle(upgradeCount: number): string {
  if (upgradeCount <= 0) {
    return "Upgrades";
  }
  return `Upgrades \u00b7 ${upgradeCount} outdated`;
}

/**
 * Services status line. Running and error counts join with a middle dot
 * (`1 running · 2 errors`). With neither, the line is `Services`.
 */
export function menuBarServicesSectionTitle(runningServices: number, erroredServices: number): string {
  const statusSegments: string[] = [];

  if (runningServices > 0) {
    statusSegments.push(`${runningServices} running`);
  }
  if (erroredServices > 0) {
    statusSegments.push(formatCount(erroredServices, "error"));
  }
  return statusSegments.length > 0 ? statusSegments.join(" \u00b7 ") : "Services";
}

export function menuBarUpgradeCount(results: OutdatedResults): number {
  return results.formulae.length + results.casks.length;
}

/** Drop the menu snapshot so the next check runs `brew outdated` instead of reusing it. */
export function invalidateMenuBarUpgrades(): void {
  cache.remove(MENU_BAR_UPGRADES_CACHE_KEY);
}

/**
 * What the menu can paint before the async fetch. A list fetched under a
 * different Greedy Upgrades setting is withheld — it is a different count.
 */
export function peekMenuBarUpgrades(
  greedy: boolean,
  now = Date.now(),
): { results?: OutdatedResults; fresh: boolean; error?: Error } {
  const snapshot = readSnapshot();
  if (!snapshot || snapshot.greedy !== greedy) {
    return { fresh: false };
  }
  return {
    results: snapshot.results,
    fresh: isFresh(snapshot, now),
    error: snapshot.failure ? failureError(snapshot.failure) : undefined,
  };
}

export function loadMenuBarUpgrades(options: LoadMenuBarUpgradesOptions): Promise<MenuBarUpgradesLoad> {
  if (!options.enabled) {
    return Promise.resolve({ status: "disabled" });
  }
  // One brew outdated per Greedy Upgrades setting. A menu-bar launch, a
  // strict-mode remount, and Refresh share it. A second process is what the
  // cache writer must not start. A cache hit does not take the slot, so
  // Refresh can still fetch when nothing is running.
  const key = options.greedy ? "greedy" : "plain";
  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }

  const now = options.now ?? Date.now();
  const snapshot = readSnapshot();
  const matching = snapshot?.greedy === options.greedy ? snapshot : undefined;
  if (!options.force && matching && isFresh(matching, now)) {
    const remembered = rememberedLoad(matching);
    if (remembered) {
      return Promise.resolve(remembered);
    }
  }

  const run = fetchMenuBarUpgrades(options, now, matching).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, run);
  return run;
}

function rememberedLoad(matching: Snapshot): MenuBarUpgradesLoad | undefined {
  if (matching.failure) {
    return {
      status: "failed",
      error: failureError(matching.failure),
      results: matching.results,
      fetchedAt: matching.attemptedAt,
    };
  }
  if (matching.results) {
    return { status: "cached", results: matching.results, fetchedAt: matching.attemptedAt };
  }
  return undefined;
}

async function fetchMenuBarUpgrades(
  options: LoadMenuBarUpgradesOptions,
  now: number,
  matching: Snapshot | undefined,
): Promise<MenuBarUpgradesLoad> {
  try {
    const results = await brewFetchOutdated(options.greedy, undefined, true);
    const fetched: Snapshot = { attemptedAt: now, greedy: options.greedy, results };
    cache.set(MENU_BAR_UPGRADES_CACHE_KEY, JSON.stringify(fetched));
    return { status: "fetched", results, fetchedAt: now };
  } catch (err) {
    const error = ensureError(err);
    brewLogger.warn("Menu bar upgrade check failed", { message: error.message });
    // Remember the attempt, and keep the last matching list. An empty results
    // write would claim the machine is up to date. The attempt time stops the
    // one-minute relaunch from running brew again until the check is old.
    const failure: StoredFailure = { lock: isBrewLockError(error), message: getErrorMessage(error) };
    const remembered: Snapshot = {
      attemptedAt: now,
      greedy: options.greedy,
      results: matching?.results,
      failure,
    };
    cache.set(MENU_BAR_UPGRADES_CACHE_KEY, JSON.stringify(remembered));
    return { status: "failed", error, results: matching?.results, fetchedAt: matching?.attemptedAt };
  }
}

function failureError(failure: StoredFailure): Error {
  return failure.lock ? new BrewLockError(failure.message) : new Error(failure.message);
}

function readFailure(value: unknown): StoredFailure | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const { lock, message } = value as Partial<StoredFailure>;
  if (typeof lock !== "boolean" || typeof message !== "string") {
    return undefined;
  }
  return { lock, message };
}

function isFresh(snapshot: Snapshot, now: number): boolean {
  const age = now - snapshot.attemptedAt;
  return age >= 0 && age < MAX_AGE_MS;
}

function readSnapshot(): Snapshot | undefined {
  const raw = cache.get(MENU_BAR_UPGRADES_CACHE_KEY);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Snapshot>;
    if (!parsed || typeof parsed.attemptedAt !== "number" || !Number.isFinite(parsed.attemptedAt)) {
      return undefined;
    }
    if (typeof parsed.greedy !== "boolean") {
      return undefined;
    }
    const results =
      parsed.results === undefined ? undefined : isOutdatedResults(parsed.results) ? parsed.results : null;
    if (results === null) {
      return undefined;
    }
    const failure = parsed.failure === undefined ? undefined : readFailure(parsed.failure);
    if (parsed.failure !== undefined && !failure) {
      return undefined;
    }
    if (!results && !failure) {
      return undefined;
    }
    return {
      attemptedAt: parsed.attemptedAt,
      greedy: parsed.greedy,
      results: results ? normalizeOutdatedResults(results) : undefined,
      failure,
    };
  } catch {
    return undefined;
  }
}

function isOutdatedResults(value: unknown): value is OutdatedResults {
  if (!value || typeof value !== "object") {
    return false;
  }
  const { formulae, casks } = value as Partial<OutdatedResults>;
  return Array.isArray(formulae) && Array.isArray(casks);
}
