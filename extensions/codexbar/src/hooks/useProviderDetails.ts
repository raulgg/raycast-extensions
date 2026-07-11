import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchProviderDetail, type ResolvedCodexBarBinary } from "../lib/codexbar";
import {
  buildCachedProviderResults,
  cacheProviderDetail,
  PROVIDER_DETAIL_CONCURRENCY,
  recordProviderDetailFailure,
  recordProviderDetailSuccess,
  runProviderDetailFetches,
  shouldRefreshProviderAutomatically,
  shouldSurfaceProviderDetailFailure,
  type ProviderDetailResults,
} from "../lib/providerDetailCache";
import type { ConfiguredProvider } from "../providers/types";

export type { ProviderDetailCacheStatus, ProviderDetailResults, ProviderDetailState } from "../lib/providerDetailCache";

type FetchProviderOptions = {
  force?: boolean;
};

type UseProviderDetailsResult = {
  results: ProviderDetailResults;
  isLoading: boolean;
  refreshProvider: (providerId: string, options?: FetchProviderOptions) => void;
};

export type InFlightProviderFetch = {
  binaryKey: string;
  fetchId: number;
  generation: number;
  mode: "auto" | "force";
  forceRequested: boolean;
};

export function useProviderDetails(
  binary: ResolvedCodexBarBinary | undefined,
  providers: ConfiguredProvider[],
  selectedProviderId?: string,
): UseProviderDetailsResult {
  const binaryKey = buildProviderDetailBinaryKey(binary);
  const providerIds = useMemo(() => providers.map((provider) => provider.id), [providers]);
  const providerIdsKey = providers.map((provider) => `${provider.id}\0${provider.source ?? "auto"}`).join("\u0001");
  const providerIdSet = useMemo(() => new Set(providerIds), [providerIdsKey]);
  const providerSources = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider.source ?? "auto"] as const)),
    [providerIdsKey],
  );
  const optimisticResults = useMemo(
    () => buildCachedProviderResults(providerIds, Date.now(), providerSources),
    [providerIdsKey],
  );
  const [results, setResults] = useState<ProviderDetailResults>({});
  const [isBatchLoading, setIsBatchLoading] = useState(false);
  const displayedResults = useMemo(() => ({ ...optimisticResults, ...results }), [optimisticResults, results]);
  const resultsRef = useRef(displayedResults);
  const optimisticResultsRef = useRef(optimisticResults);
  const binaryRef = useRef(binary);
  const binaryKeyRef = useRef(binaryKey);
  const providerIdsRef = useRef(providerIdSet);
  const providerSourcesRef = useRef(providerSources);
  const inFlightRef = useRef(new Map<string, InFlightProviderFetch>());
  const completedRef = useRef(new Map<string, number>());
  const openRefreshKeysRef = useRef(new Set<string>());
  const generationRef = useRef(0);
  const nextFetchIdRef = useRef(0);

  binaryRef.current = binary;
  binaryKeyRef.current = binaryKey;
  providerIdsRef.current = providerIdSet;
  providerSourcesRef.current = providerSources;
  optimisticResultsRef.current = optimisticResults;

  useEffect(() => {
    resultsRef.current = displayedResults;
  }, [displayedResults]);

  const fetchOneProvider = useCallback(
    async (providerId: string, generation: number, options?: FetchProviderOptions) => {
      const currentBinary = binaryRef.current;
      const currentBinaryKey = binaryKeyRef.current;
      if (!currentBinary || !currentBinaryKey || !providerId) {
        return;
      }

      const force = options?.force === true;
      const inFlightFetch = inFlightRef.current.get(providerId);
      if (inFlightFetch) {
        if (inFlightFetch.binaryKey === currentBinaryKey) {
          inFlightFetch.generation = generation;
          requestForceOnInFlightProviderFetch(inFlightFetch, force);
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
        mode: force ? "force" : "auto",
        forceRequested: false,
      });

      setProviderLoading(providerId, setResults, optimisticResultsRef.current);

      try {
        const detail = await fetchProviderDetail(currentBinary, providerId, {
          mode: force ? "force" : "auto",
          source: providerSourcesRef.current.get(providerId),
          interaction: "user",
        });
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

        completedRef.current.set(providerId, completedFetch?.generation ?? generation);
        recordProviderDetailSuccess(providerId);
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

        completedRef.current.set(providerId, completedFetch?.generation ?? generation);
        const previousResult = resultsRef.current[providerId];
        const failureCount = recordProviderDetailFailure(providerId);
        const surfacedError = shouldSurfaceProviderDetailFailure(Boolean(previousResult?.detail), failureCount)
          ? toError(error)
          : undefined;
        setResults((current) => ({
          ...current,
          [providerId]: { ...previousResult, error: surfacedError, isLoading: false },
        }));
      } finally {
        const completedFetch = inFlightRef.current.get(providerId);
        const chainForce = shouldChainForceProviderFetch(completedFetch, fetchId);
        const chainGeneration = completedFetch?.generation ?? generation;

        if (completedFetch?.fetchId === fetchId) {
          inFlightRef.current.delete(providerId);
        }

        if (chainForce) {
          void fetchOneProvider(providerId, chainGeneration, { force: true });
        }
      }
    },
    [],
  );

  const fetchProviderIfNeeded = useCallback(
    async (providerId: string, generation: number) => {
      const shouldRefresh = shouldRefreshProviderAutomatically(
        resultsRef.current[providerId],
        completedRef.current.get(providerId),
        generation,
      );
      if (!shouldRefresh) {
        return;
      }

      await fetchOneProvider(providerId, generation);
    },
    [fetchOneProvider],
  );

  const refreshProviderOnOpen = useCallback(
    async (providerId: string, generation: number) => {
      const refreshKey = `${binaryKeyRef.current}\0${providerId}\0${providerSourcesRef.current.get(providerId) ?? "auto"}`;
      if (claimProviderOpenRefresh(openRefreshKeysRef.current, refreshKey)) {
        await fetchOneProvider(providerId, generation, { force: true });
        return;
      }

      await fetchProviderIfNeeded(providerId, generation);
    },
    [fetchOneProvider, fetchProviderIfNeeded],
  );

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    completedRef.current.clear();
    const currentProviderIds = providerIds;
    setResults((current) => preserveInFlightProviderResults(current, inFlightRef.current));

    if (!binaryKey || currentProviderIds.length === 0) {
      setIsBatchLoading(false);
      return;
    }

    setIsBatchLoading(true);
    void runProviderDetailFetches({
      providerIds: currentProviderIds,
      concurrency: PROVIDER_DETAIL_CONCURRENCY,
      fetchProvider: (providerId) => refreshProviderOnOpen(providerId, generation),
    }).finally(() => {
      if (generationRef.current === generation) {
        setIsBatchLoading(false);
      }
    });
  }, [binaryKey, providerIdsKey, refreshProviderOnOpen]);

  useEffect(() => {
    if (!binaryKey || !selectedProviderId) {
      return;
    }

    void fetchProviderIfNeeded(selectedProviderId, generationRef.current);
  }, [binaryKey, fetchProviderIfNeeded, selectedProviderId]);

  const refreshProvider = useCallback(
    (providerId: string, options?: FetchProviderOptions) => {
      if (!providerId) {
        return;
      }

      void fetchOneProvider(providerId, generationRef.current, options);
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

export function claimProviderOpenRefresh(completedRefreshes: Set<string>, refreshKey: string): boolean {
  if (completedRefreshes.has(refreshKey)) {
    return false;
  }

  completedRefreshes.add(refreshKey);
  return true;
}

function buildProviderDetailBinaryKey(binary: ResolvedCodexBarBinary | undefined): string {
  return binary ? `${binary.source}\0${binary.command}\0${JSON.stringify(binary.capabilities ?? null)}` : "";
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
}): boolean {
  return (
    inFlightFetch?.fetchId === fetchId &&
    inFlightFetch.binaryKey === binaryKey &&
    binaryKey === currentBinaryKey &&
    currentProviderIds.has(providerId)
  );
}

/** Mark forceRequested when a force refresh arrives while a non-force fetch is in flight. */
export function requestForceOnInFlightProviderFetch(inFlightFetch: InFlightProviderFetch, force: boolean): void {
  if (force && inFlightFetch.mode !== "force") {
    inFlightFetch.forceRequested = true;
  }
}

/** After a non-force fetch completes, chain a force fetch if one was requested while in flight. */
export function shouldChainForceProviderFetch(
  inFlightFetch: InFlightProviderFetch | undefined,
  fetchId: number,
): boolean {
  return inFlightFetch?.fetchId === fetchId && inFlightFetch.forceRequested === true && inFlightFetch.mode !== "force";
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

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}
