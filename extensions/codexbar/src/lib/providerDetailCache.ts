import { Cache } from "@raycast/api";
import type { ProviderDetailData, ProviderSourceMode } from "../providers/types";
import type { KeychainAccessPolicy } from "./keychainAccessPolicy";

export const PROVIDER_DETAIL_CONCURRENCY = 4;
const PROVIDER_DETAIL_FRESHNESS_WINDOW_MS = 10 * 60 * 1000;
export const PROVIDER_DETAIL_STALE_WINDOW_MS = 60 * 60 * 1000;
const PROVIDER_DETAIL_SCHEMA_VERSION = "provider-details-v7";
const LEGACY_PROVIDER_DETAIL_SCHEMA_VERSION = "provider-details-v6";
const PROVIDER_DETAIL_INDEX_KEY = `${PROVIDER_DETAIL_SCHEMA_VERSION}:index`;
const KEYCHAIN_ACCESS_POLICIES: KeychainAccessPolicy[] = ["default", "disabled"];
const providerDetailCache = new Cache({ namespace: "provider-details" });
const providerDetailFailureCache = new Cache({ namespace: "provider-detail-failures" });

export type ProviderDetailCacheStatus = "fresh" | "stale";

export type ProviderDetailState = {
  detail?: ProviderDetailData;
  error?: Error;
  isLoading: boolean;
  cacheStatus?: ProviderDetailCacheStatus;
};

export type ProviderDetailResults = Record<string, ProviderDetailState | undefined>;

type FetchProviderDetail = (providerId: string) => Promise<void>;

type RunProviderDetailFetchesOptions = {
  providerIds: string[];
  concurrency?: number;
  fetchProvider: FetchProviderDetail;
  shouldSkip?: (providerId: string) => boolean;
};

export async function runProviderDetailFetches({
  providerIds,
  concurrency = PROVIDER_DETAIL_CONCURRENCY,
  fetchProvider,
  shouldSkip,
}: RunProviderDetailFetchesOptions): Promise<void> {
  const workerCount = Math.min(Math.max(1, concurrency), providerIds.length);
  let nextProviderIndex = 0;

  async function runWorker() {
    while (nextProviderIndex < providerIds.length) {
      const providerId = providerIds[nextProviderIndex];
      nextProviderIndex += 1;

      if (!providerId || shouldSkip?.(providerId)) {
        continue;
      }

      await fetchProvider(providerId);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}

export function shouldRefreshSelectedProvider(
  result: ProviderDetailState | undefined,
  completedGeneration: number | undefined,
  currentGeneration: number,
  now = Date.now(),
): boolean {
  return shouldRefreshProviderAutomatically(result, completedGeneration, currentGeneration, now);
}

export function shouldRefreshProviderAutomatically(
  result: ProviderDetailState | undefined,
  completedGeneration: number | undefined,
  currentGeneration: number,
  now = Date.now(),
): boolean {
  if (!result) {
    return completedGeneration !== currentGeneration;
  }

  if (result.isLoading) {
    return false;
  }

  if (result.error) {
    return completedGeneration !== currentGeneration;
  }

  if (!result.detail) {
    return completedGeneration !== currentGeneration;
  }

  return isProviderDetailOlderThan(result.detail, PROVIDER_DETAIL_FRESHNESS_WINDOW_MS, now);
}

export function buildCachedProviderResults(
  providerIds: string[],
  keychainAccessPolicy: KeychainAccessPolicy,
  now = Date.now(),
  requestedSources?: ReadonlyMap<string, ProviderSourceMode>,
): ProviderDetailResults {
  return Object.fromEntries(
    providerIds.flatMap((providerId) => {
      const cachedDetail = readCachedProviderDetail(
        providerId,
        keychainAccessPolicy,
        now,
        requestedSources?.get(providerId),
      );
      return cachedDetail ? [[providerId, { ...cachedDetail, isLoading: false } satisfies ProviderDetailState]] : [];
    }),
  );
}

export function cacheProviderDetail(detail: ProviderDetailData, keychainAccessPolicy: KeychainAccessPolicy): void {
  providerDetailCache.set(buildProviderDetailCacheKey(detail.id, keychainAccessPolicy), JSON.stringify(detail));
  trackProviderDetailCacheId(detail.id);
}

export function readCachedProviderDetail(
  providerId: string,
  keychainAccessPolicy: KeychainAccessPolicy,
  now = Date.now(),
  requestedSource?: ProviderSourceMode,
): Pick<ProviderDetailState, "detail" | "cacheStatus"> | undefined {
  const cacheKey = buildProviderDetailCacheKey(providerId, keychainAccessPolicy);
  const serializedDetail = providerDetailCache.get(cacheKey);
  if (!serializedDetail) {
    return undefined;
  }

  try {
    const detail = JSON.parse(serializedDetail) as ProviderDetailData;
    const cacheStatus = getProviderDetailCacheStatus(detail, providerId, now, requestedSource);
    if (!cacheStatus) {
      if (!getProviderDetailCacheStatus(detail, providerId, now)) {
        providerDetailCache.remove(cacheKey);
        untrackProviderDetailCacheIdIfEmpty(providerId);
      }
      return undefined;
    }

    return { detail, cacheStatus };
  } catch {
    providerDetailCache.remove(cacheKey);
    untrackProviderDetailCacheIdIfEmpty(providerId);
    return undefined;
  }
}

function getProviderDetailCacheStatus(
  detail: ProviderDetailData,
  providerId: string,
  now = Date.now(),
  requestedSource?: ProviderSourceMode,
): ProviderDetailCacheStatus | undefined {
  if (
    detail.id !== providerId ||
    !isProviderDetailSchemaCurrent(detail) ||
    (requestedSource !== undefined && detail.requestedSource !== requestedSource)
  ) {
    return undefined;
  }

  if (!isProviderDetailOlderThan(detail, PROVIDER_DETAIL_FRESHNESS_WINDOW_MS, now)) {
    return "fresh";
  }

  if (!isProviderDetailOlderThan(detail, PROVIDER_DETAIL_STALE_WINDOW_MS, now)) {
    return "stale";
  }

  return undefined;
}

function isProviderDetailOlderThan(detail: ProviderDetailData, maxAgeMs: number, now = Date.now()): boolean {
  const fetchedAtMs = Date.parse(detail.fetchedAt);
  return Number.isNaN(fetchedAtMs) || now - fetchedAtMs > maxAgeMs;
}

function isProviderDetailSchemaCurrent(detail: ProviderDetailData): boolean {
  return detail.sections.every(({ kind }) => kind === "usage" || kind === "supplementalUsage" || kind === "info");
}

function buildProviderDetailCacheKey(providerId: string, keychainAccessPolicy: KeychainAccessPolicy): string {
  return `${PROVIDER_DETAIL_SCHEMA_VERSION}:${keychainAccessPolicy}:${providerId}`;
}

export function recordProviderDetailSuccess(providerId: string, keychainAccessPolicy: KeychainAccessPolicy): void {
  providerDetailFailureCache.remove(buildProviderDetailFailureKey(providerId, keychainAccessPolicy));
}

export function recordProviderDetailFailure(providerId: string, keychainAccessPolicy: KeychainAccessPolicy): number {
  const key = buildProviderDetailFailureKey(providerId, keychainAccessPolicy);
  const previous = Number.parseInt(providerDetailFailureCache.get(key) ?? "0", 10);
  const count = Number.isFinite(previous) ? previous + 1 : 1;
  providerDetailFailureCache.set(key, String(count));
  return count;
}

export function shouldSurfaceProviderDetailFailure(hasCachedDetail: boolean, consecutiveFailures: number): boolean {
  return !hasCachedDetail || consecutiveFailures >= 2;
}

function buildProviderDetailFailureKey(providerId: string, keychainAccessPolicy: KeychainAccessPolicy): string {
  return `${PROVIDER_DETAIL_SCHEMA_VERSION}:${keychainAccessPolicy}:${providerId}`;
}

export function pruneProviderDetailCaches(providerIds: string[] = [], now = Date.now()): void {
  const trackedProviderIds = readProviderDetailCacheIndex();
  const providerIdsToPrune = new Set([...trackedProviderIds, ...providerIds]);

  for (const providerId of providerIdsToPrune) {
    providerDetailCache.remove(`${LEGACY_PROVIDER_DETAIL_SCHEMA_VERSION}:${providerId}`);

    for (const policy of KEYCHAIN_ACCESS_POLICIES) {
      const key = buildProviderDetailCacheKey(providerId, policy);
      const serialized = providerDetailCache.get(key);
      if (!serialized) continue;

      try {
        const detail = JSON.parse(serialized) as ProviderDetailData;
        if (!getProviderDetailCacheStatus(detail, providerId, now)) {
          providerDetailCache.remove(key);
        }
      } catch {
        providerDetailCache.remove(key);
      }
    }

    if (!hasAnyProviderDetailCacheEntry(providerId)) {
      trackedProviderIds.delete(providerId);
    }
  }

  writeProviderDetailCacheIndex(trackedProviderIds);
}

function trackProviderDetailCacheId(providerId: string): void {
  const trackedProviderIds = readProviderDetailCacheIndex();
  trackedProviderIds.add(providerId);
  writeProviderDetailCacheIndex(trackedProviderIds);
}

function untrackProviderDetailCacheIdIfEmpty(providerId: string): void {
  if (hasAnyProviderDetailCacheEntry(providerId)) return;
  const trackedProviderIds = readProviderDetailCacheIndex();
  trackedProviderIds.delete(providerId);
  writeProviderDetailCacheIndex(trackedProviderIds);
}

function hasAnyProviderDetailCacheEntry(providerId: string): boolean {
  return KEYCHAIN_ACCESS_POLICIES.some((policy) =>
    Boolean(providerDetailCache.get(buildProviderDetailCacheKey(providerId, policy))),
  );
}

function readProviderDetailCacheIndex(): Set<string> {
  const serialized = providerDetailCache.get(PROVIDER_DETAIL_INDEX_KEY);
  if (!serialized) return new Set();

  try {
    const providerIds = JSON.parse(serialized) as unknown;
    if (!Array.isArray(providerIds) || !providerIds.every((providerId) => typeof providerId === "string")) {
      throw new Error("invalid provider detail cache index");
    }
    return new Set(providerIds);
  } catch {
    providerDetailCache.remove(PROVIDER_DETAIL_INDEX_KEY);
    return new Set();
  }
}

function writeProviderDetailCacheIndex(providerIds: Set<string>): void {
  if (providerIds.size === 0) {
    providerDetailCache.remove(PROVIDER_DETAIL_INDEX_KEY);
    return;
  }
  providerDetailCache.set(PROVIDER_DETAIL_INDEX_KEY, JSON.stringify([...providerIds]));
}
