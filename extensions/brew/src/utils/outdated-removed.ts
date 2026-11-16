/**
 * Packages that actually upgraded, one LocalStorage item each.
 *
 * A list hides a package only when that item's time is later than the list's
 * own fetch start. A newer `brew outdated` that still names the package shows
 * it again. The lists themselves stay on disk: deleting one is what makes the
 * packages that did not upgrade disappear.
 *
 * Keys match across the two shapes a package has. An outdated row is
 * `formula-<name>` or `cask-<name>`. An installed formula uses
 * `brewIdentifier`, so a tapped formula (`user/repo/name`) meets the outdated
 * row's full name. An installed cask uses its token without the tap, because
 * an outdated cask is unqualified. Formula and cask keys stay distinct, so a
 * formula named `docker` does not hide the cask.
 */

import { LocalStorage } from "@raycast/api";
import { upgradeKey, type UpgradePackage } from "./brew/upgrade";
import { brewIdentifier, isCask } from "./brew/helpers";
import type { Cask, Nameable } from "./types";

const PREFIX = "outdated-removed/";
/** A removal older than this no longer hides a row, and the next write drops it. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const listeners = new Set<() => void>();

/** Same-process views re-read after a write. Another process has to poll. */
export function subscribeRemoved(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function removalStorageKey(key: string): string {
  return `${PREFIX}${key}`;
}

/**
 * Identity stored for one upgraded package.
 *
 * An `{ name, isCask }` is an outdated row (or the batch event's package) and
 * uses `upgradeKey` directly. Anything with a `token` is a cask, installed or
 * outdated, and keeps the unqualified token. A formula uses `brewIdentifier`.
 */
export function removalKey(item: UpgradePackage | Cask | Nameable): string {
  if (isUpgradePackage(item)) {
    return upgradeKey(item);
  }
  if (isCask(item)) {
    return upgradeKey({ name: caskTokenWithoutTap(item), isCask: true });
  }
  return upgradeKey({ name: brewIdentifier(item), isCask: false });
}

export async function forgetUpgraded(
  packages: ReadonlyArray<UpgradePackage | Cask | Nameable>,
  at = Date.now(),
): Promise<void> {
  await pruneRemoved(at);
  for (const pkg of packages) {
    await LocalStorage.setItem(removalStorageKey(removalKey(pkg)), String(at));
  }
  for (const listener of listeners) listener();
}

/** Keys still inside the 24-hour window, mapped to the time they finished. */
export async function readRemoved(now = Date.now()): Promise<Map<string, number>> {
  const items = await LocalStorage.allItems();
  const removed = new Map<string, number>();
  for (const [storageKey, value] of Object.entries(items)) {
    if (!storageKey.startsWith(PREFIX)) continue;
    const removedAt = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(removedAt) || now - removedAt > MAX_AGE_MS) continue;
    removed.set(storageKey.slice(PREFIX.length), removedAt);
  }
  return removed;
}

/**
 * The only reader rule. A package leaves the list when its removal is strictly
 * later than `startedAt` — the moment that list's fetch began, not the moment
 * it was saved. An equal time stays: the fetch was not older than the upgrade.
 */
export function subtractRemoved<T extends { formulae: { name: string }[]; casks: { name: string }[] }>(
  list: T,
  removed: ReadonlyMap<string, number>,
  startedAt: number,
): T {
  return {
    ...list,
    formulae: list.formulae.filter((item) => !removedAfter(item.name, false, removed, startedAt)),
    casks: list.casks.filter((item) => !removedAfter(item.name, true, removed, startedAt)),
  };
}

async function pruneRemoved(now: number): Promise<void> {
  const items = await LocalStorage.allItems();
  for (const [storageKey, value] of Object.entries(items)) {
    if (!storageKey.startsWith(PREFIX)) continue;
    const removedAt = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(removedAt) || now - removedAt > MAX_AGE_MS) {
      await LocalStorage.removeItem(storageKey);
    }
  }
}

function removedAfter(
  name: string,
  isCaskPackage: boolean,
  removed: ReadonlyMap<string, number>,
  startedAt: number,
): boolean {
  const removedAt = removed.get(upgradeKey({ name, isCask: isCaskPackage }));
  return removedAt !== undefined && removedAt > startedAt;
}

function isUpgradePackage(item: UpgradePackage | Cask | Nameable): item is UpgradePackage {
  return typeof (item as UpgradePackage).isCask === "boolean" && (item as { token?: unknown }).token === undefined;
}

/**
 * Outdated casks are unqualified. An installed cask's token usually is too;
 * a qualified `user/repo/token` still has to meet that row, so the tap prefix
 * is not part of the key.
 */
function caskTokenWithoutTap(cask: { token: string; tap?: string | null }): string {
  const { token, tap } = cask;
  if (tap && token.startsWith(`${tap}/`)) return token.slice(tap.length + 1);
  const parts = token.split("/");
  return parts.length >= 3 ? parts[parts.length - 1] : token;
}
