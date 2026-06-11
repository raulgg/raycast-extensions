import { Cache } from "@raycast/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchProviderDetail, type ResolvedCodexBarBinary } from "../lib/codexbar";
import type { ConfiguredProvider, ProviderDetailData } from "../providers/types";

const PROVIDER_DETAIL_CONCURRENCY = 4;
const PROVIDER_DETAIL_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;
const PROVIDER_DETAIL_STALE_WINDOW_MS = 60 * 60 * 1000;
const SELECTED_PROVIDER_REFRESH_STALE_MS = 60 * 1000;
const PROVIDER_DETAIL_SCHEMA_VERSION = "provider-details-v4";
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

type UseProviderDetailsResult = {
  results: ProviderDetailResults;
  isLoading: boolean;
  refreshProvider: (providerId: string) => void;
};

export type InFlightProviderFetch = {
  binaryKey: string;
  fetchId: number;
  generation: number;
};

export function useProviderDetails(
  binary: ResolvedCodexBarBinary | undefined,
  providers: ConfiguredProvider[],
  selectedProviderId?: string,
): UseProviderDetailsResult {
  const binaryKey = buildProviderDetailBinaryKey(binary);
  const providerIds = useMemo(() => providers.map((provider) => provider.id), [providers]);
  const providerIdsKey = providerIds.join("\0");
  const providerIdSet = useMemo(() => new Set(providerIds), [providerIdsKey]);
  const optimisticResults = useMemo(() => buildCachedProviderResults(providerIds), [providerIds, providerIdsKey]);
  const [results, setResults] = useState<ProviderDetailResults>({});
  const [isBatchLoading, setIsBatchLoading] = useState(false);
  const displayedResults = useMemo(() => ({ ...optimisticResults, ...results }), [optimisticResults, results]);
  const resultsRef = useRef(displayedResults);
  const optimisticResultsRef = useRef(optimisticResults);
  const binaryRef = useRef(binary);
  const binaryKeyRef = useRef(binaryKey);
  const providerIdsRef = useRef(providerIdSet);
  const inFlightRef = useRef(new Map<string, InFlightProviderFetch>());
  const completedRef = useRef(new Map<string, number>());
  const generationRef = useRef(0);
  const nextFetchIdRef = useRef(0);

  binaryRef.current = binary;
  binaryKeyRef.current = binaryKey;
  providerIdsRef.current = providerIdSet;
  optimisticResultsRef.current = optimisticResults;

  useEffect(() => {
    resultsRef.current = displayedResults;
  }, [displayedResults]);

  const fetchOneProvider = useCallback(async (providerId: string, generation: number) => {
    const currentBinary = binaryRef.current;
    const currentBinaryKey = binaryKeyRef.current;
    if (!currentBinary || !currentBinaryKey || !providerId) {
      return;
    }

    const inFlightFetch = inFlightRef.current.get(providerId);
    if (inFlightFetch) {
      if (inFlightFetch.binaryKey === currentBinaryKey) {
        inFlightFetch.generation = generation;
      }

      setProviderLoading(providerId, setResults, optimisticResultsRef.current);
      return;
    }

    nextFetchIdRef.current += 1;
    const fetchId = nextFetchIdRef.current;
    inFlightRef.current.set(providerId, {
      binaryKey: currentBinaryKey,
      fetchId,
      generation,
    });

    setProviderLoading(providerId, setResults, optimisticResultsRef.current);

    try {
      const detail = await fetchProviderDetail(currentBinary, providerId);
      const completedFetch = inFlightRef.current.get(providerId);
      if (
        !canApplyProviderFetchResult({
          binaryKey: currentBinaryKey,
          currentBinaryKey: binaryKeyRef.current,
          currentProviderIds: providerIdsRef.current,
          fetchId,
          inFlightFetch: completedFetch,
          providerId,
        })
      ) {
        clearProviderLoading(providerId, fetchId, inFlightRef.current, setResults);
        return;
      }

      completedRef.current.set(providerId, completedFetch.generation);
      cacheProviderDetail(detail);
      setResults((current) => ({
        ...current,
        [providerId]: { detail, isLoading: false, cacheStatus: "fresh" },
      }));
    } catch (error) {
      const completedFetch = inFlightRef.current.get(providerId);
      if (
        !canApplyProviderFetchResult({
          binaryKey: currentBinaryKey,
          currentBinaryKey: binaryKeyRef.current,
          currentProviderIds: providerIdsRef.current,
          fetchId,
          inFlightFetch: completedFetch,
          providerId,
        })
      ) {
        clearProviderLoading(providerId, fetchId, inFlightRef.current, setResults);
        return;
      }

      completedRef.current.set(providerId, completedFetch.generation);
      setResults((current) => ({
        ...current,
        [providerId]: { ...current[providerId], error: toError(error), isLoading: false },
      }));
    } finally {
      if (inFlightRef.current.get(providerId)?.fetchId === fetchId) {
        inFlightRef.current.delete(providerId);
      }
    }
  }, []);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    completedRef.current.clear();
    const currentProviderIds = providerIdsKey ? providerIdsKey.split("\0") : [];
    setResults((current) => preserveInFlightProviderResults(current, inFlightRef.current));

    if (!binaryKey || currentProviderIds.length === 0) {
      setIsBatchLoading(false);
      return;
    }

    setIsBatchLoading(true);
    void runProviderDetailFetches({
      providerIds: currentProviderIds,
      concurrency: PROVIDER_DETAIL_CONCURRENCY,
      fetchProvider: (providerId) => fetchOneProvider(providerId, generation),
      shouldSkip: (providerId) => {
        return completedRef.current.get(providerId) === generation;
      },
    }).finally(() => {
      if (generationRef.current === generation) {
        setIsBatchLoading(false);
      }
    });
  }, [binaryKey, fetchOneProvider, providerIdsKey]);

  useEffect(() => {
    if (!binaryKey || !selectedProviderId) {
      return;
    }

    const result = resultsRef.current[selectedProviderId];
    const completedGeneration = completedRef.current.get(selectedProviderId);
    if (!shouldRefreshSelectedProvider(result, completedGeneration, generationRef.current)) {
      return;
    }

    void fetchOneProvider(selectedProviderId, generationRef.current);
  }, [binaryKey, fetchOneProvider, selectedProviderId]);

  const refreshProvider = useCallback(
    (providerId: string) => {
      if (!providerId) {
        return;
      }

      void fetchOneProvider(providerId, generationRef.current);
    },
    [fetchOneProvider],
  );

  const hasProviderLoading = Object.values(results).some((result) => result?.isLoading);

  return {
    results: displayedResults,
    isLoading: isBatchLoading || hasProviderLoading,
    refreshProvider,
  };
}

function buildProviderDetailBinaryKey(binary: ResolvedCodexBarBinary | undefined): string {
  return binary ? `${binary.source}\0${binary.command}` : "";
}

export function canApplyProviderFetchResult({
  binaryKey,
  currentBinaryKey,
  currentProviderIds,
  fetchId,
  inFlightFetch,
  providerId,
}: {
  binaryKey: string;
  currentBinaryKey: string;
  currentProviderIds: Set<string>;
  fetchId: number;
  inFlightFetch: InFlightProviderFetch | undefined;
  providerId: string;
}): inFlightFetch is InFlightProviderFetch {
  return (
    inFlightFetch?.fetchId === fetchId &&
    inFlightFetch.binaryKey === binaryKey &&
    binaryKey === currentBinaryKey &&
    currentProviderIds.has(providerId)
  );
}

export function preserveInFlightProviderResults(
  results: ProviderDetailResults,
  inFlightFetches: Map<string, InFlightProviderFetch>,
): ProviderDetailResults {
  return Object.fromEntries(Object.entries(results).filter(([providerId]) => inFlightFetches.has(providerId)));
}

function setProviderLoading(
  providerId: string,
  setResults: (update: (current: ProviderDetailResults) => ProviderDetailResults) => void,
  optimisticResults: ProviderDetailResults,
): void {
  setResults((current) => ({
    ...current,
    [providerId]: {
      ...(current[providerId] ?? optimisticResults[providerId]),
      error: undefined,
      isLoading: true,
    },
  }));
}

function clearProviderLoading(
  providerId: string,
  fetchId: number,
  inFlightFetches: Map<string, InFlightProviderFetch>,
  setResults: (update: (current: ProviderDetailResults) => ProviderDetailResults) => void,
): void {
  if (inFlightFetches.get(providerId)?.fetchId !== fetchId) {
    return;
  }

  setResults((current) => {
    const currentResult = current[providerId];
    if (!currentResult?.isLoading) {
      return current;
    }

    return {
      ...current,
      [providerId]: {
        ...currentResult,
        isLoading: false,
      },
    };
  });
}

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

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

export function shouldRefreshSelectedProvider(
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

  return isProviderDetailOlderThan(result.detail, SELECTED_PROVIDER_REFRESH_STALE_MS, now);
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

function readCachedProviderDetail(
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
