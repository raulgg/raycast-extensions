import { Cache } from "@raycast/api";
import type { ProviderDetailData, ProviderSourceMode } from "../providers/types";

export const PROVIDER_DETAIL_CONCURRENCY = 4;
const PROVIDER_DETAIL_FRESHNESS_WINDOW_MS = 10 * 60 * 1000;
const PROVIDER_DETAIL_STALE_WINDOW_MS = 60 * 60 * 1000;
const PROVIDER_DETAIL_SCHEMA_VERSION = "provider-details-v6";
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
  now = Date.now(),
  requestedSources?: ReadonlyMap<string, ProviderSourceMode>,
): ProviderDetailResults {
  return Object.fromEntries(
    providerIds.flatMap((providerId) => {
      const cachedDetail = readCachedProviderDetail(providerId, now, requestedSources?.get(providerId));
      return cachedDetail ? [[providerId, { ...cachedDetail, isLoading: false } satisfies ProviderDetailState]] : [];
    }),
  );
}

export function cacheProviderDetail(detail: ProviderDetailData): void {
  providerDetailCache.set(buildProviderDetailCacheKey(detail.id), JSON.stringify(detail));
}

export function readCachedProviderDetail(
  providerId: string,
  now = Date.now(),
  requestedSource?: ProviderSourceMode,
): Pick<ProviderDetailState, "detail" | "cacheStatus"> | undefined {
  const serializedDetail = providerDetailCache.get(buildProviderDetailCacheKey(providerId));
  if (!serializedDetail) {
    return undefined;
  }

  try {
    const detail = JSON.parse(serializedDetail) as ProviderDetailData;
    const cacheStatus = getProviderDetailCacheStatus(detail, providerId, now, requestedSource);
    if (!cacheStatus) {
      return undefined;
    }

    return { detail, cacheStatus };
  } catch {
    providerDetailCache.remove(buildProviderDetailCacheKey(providerId));
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

function buildProviderDetailCacheKey(providerId: string): string {
  return `${PROVIDER_DETAIL_SCHEMA_VERSION}:${providerId}`;
}

export function recordProviderDetailSuccess(providerId: string): void {
  providerDetailFailureCache.remove(buildProviderDetailFailureKey(providerId));
}

export function recordProviderDetailFailure(providerId: string): number {
  const key = buildProviderDetailFailureKey(providerId);
  const previous = Number.parseInt(providerDetailFailureCache.get(key) ?? "0", 10);
  const count = Number.isFinite(previous) ? previous + 1 : 1;
  providerDetailFailureCache.set(key, String(count));
  return count;
}

export function shouldSurfaceProviderDetailFailure(hasCachedDetail: boolean, consecutiveFailures: number): boolean {
  return !hasCachedDetail || consecutiveFailures >= 2;
}

function buildProviderDetailFailureKey(providerId: string): string {
  return `${PROVIDER_DETAIL_SCHEMA_VERSION}:${providerId}`;
}
