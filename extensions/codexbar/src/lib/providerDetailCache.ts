import { Cache } from "@raycast/api";
import type { ProviderDetailData, ProviderSection } from "../providers/types";

export const PROVIDER_DETAIL_CONCURRENCY = 4;
const PROVIDER_DETAIL_FRESHNESS_WINDOW_MS = 10 * 60 * 1000;
const PROVIDER_DETAIL_STALE_WINDOW_MS = 60 * 60 * 1000;
const PROVIDER_DETAIL_SCHEMA_VERSION = "provider-details-v5";
const providerDetailCache = new Cache({ namespace: "provider-details" });

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

export function resolveProviderRefreshMode(
  result: ProviderDetailState | undefined,
  completedGeneration: number | undefined,
  currentGeneration: number,
  options?: {
    forceInitialRefresh?: boolean;
    forceInitialRefreshCompleted?: boolean;
    now?: number;
  },
): "auto" | "force" | undefined {
  if (options?.forceInitialRefresh && !options.forceInitialRefreshCompleted) {
    return "force";
  }

  return shouldRefreshProviderAutomatically(result, completedGeneration, currentGeneration, options?.now)
    ? "auto"
    : undefined;
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

  if (result.isLoading || result.error) {
    return false;
  }

  if (!result.detail) {
    return completedGeneration !== currentGeneration;
  }

  return isProviderDetailOlderThan(result.detail, PROVIDER_DETAIL_FRESHNESS_WINDOW_MS, now);
}

export function buildCachedProviderResults(providerIds: string[], now = Date.now()): ProviderDetailResults {
  return Object.fromEntries(
    providerIds.flatMap((providerId) => {
      const cachedDetail = readCachedProviderDetail(providerId, now);
      return cachedDetail ? [[providerId, { ...cachedDetail, isLoading: false } satisfies ProviderDetailState]] : [];
    }),
  );
}

export function cacheProviderDetail(detail: ProviderDetailData): void {
  providerDetailCache.set(buildProviderDetailCacheKey(detail.id), JSON.stringify(detail));
}

export function cacheProviderDetailIfRicher(detail: ProviderDetailData, now = Date.now()): boolean {
  const currentDetail = readCachedProviderDetail(detail.id, now)?.detail;
  if (!shouldReplaceProviderDetail(currentDetail, detail)) {
    return false;
  }

  cacheProviderDetail(detail);
  return true;
}

export function readCachedProviderDetail(
  providerId: string,
  now = Date.now(),
): Pick<ProviderDetailState, "detail" | "cacheStatus"> | undefined {
  const serializedDetail = providerDetailCache.get(buildProviderDetailCacheKey(providerId));
  if (!serializedDetail) {
    return undefined;
  }

  try {
    const detail = JSON.parse(serializedDetail) as ProviderDetailData;
    const cacheStatus = getProviderDetailCacheStatus(detail, providerId, now);
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
): ProviderDetailCacheStatus | undefined {
  if (detail.id !== providerId || !isProviderDetailSchemaCurrent(detail)) {
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

export function shouldReplaceProviderDetail(
  currentDetail: ProviderDetailData | undefined,
  nextDetail: ProviderDetailData,
): boolean {
  if (!currentDetail || currentDetail.id !== nextDetail.id) {
    return true;
  }

  if (hasProviderUsageValueChanged(currentDetail, nextDetail)) {
    return true;
  }

  return getProviderDetailQualityScore(nextDetail) >= getProviderDetailQualityScore(currentDetail);
}

function hasProviderUsageValueChanged(currentDetail: ProviderDetailData, nextDetail: ProviderDetailData): boolean {
  const currentUsageSections = new Map(
    currentDetail.sections
      .filter((section) => section.kind === "usage" || section.kind === "supplementalUsage")
      .map((section) => [buildProviderUsageSectionKey(section), section]),
  );

  return nextDetail.sections.some((section) => {
    if (section.kind !== "usage" && section.kind !== "supplementalUsage") {
      return false;
    }

    const currentSection = currentUsageSections.get(buildProviderUsageSectionKey(section));
    if (!currentSection) {
      return false;
    }

    return (
      currentSection.remainingPercent !== section.remainingPercent ||
      currentSection.nextRegenPercent !== section.nextRegenPercent
    );
  });
}

function buildProviderUsageSectionKey(
  section: Extract<ProviderSection, { kind: "usage" | "supplementalUsage" }>,
): string {
  if (section.kind === "usage") {
    return `${section.kind}\0${section.title}\0${section.displayTitle}`;
  }

  return `${section.kind}\0${section.title}`;
}

function getProviderDetailQualityScore(detail: ProviderDetailData): number {
  const metadataScore = (detail.accountEmail ? 2 : 0) + (detail.planText ? 2 : 0) + (detail.updatedAt ? 1 : 0);

  return detail.sections.reduce((score, section) => {
    if (section.kind === "usage") {
      return (
        score +
        20 +
        (section.resetsIn ? 5 : 0) +
        (section.usagePacing ? 3 : 0) +
        (section.nextRegenPercent !== undefined ? 1 : 0)
      );
    }

    if (section.kind === "supplementalUsage") {
      return (
        score +
        12 +
        (section.resetsIn ? 4 : 0) +
        (section.usagePacing ? 3 : 0) +
        (section.nextRegenPercent !== undefined ? 1 : 0)
      );
    }

    return score + Math.max(1, section.items.length);
  }, metadataScore);
}
