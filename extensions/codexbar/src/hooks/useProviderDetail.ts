import { useCachedPromise } from "@raycast/utils";
import { fetchProviderDetail, type ResolvedCodexBarBinary } from "../lib/codexbar";
import type { ProviderDetailData } from "../providers/types";

/** Provider detail newer than this is still considered valid while a refetch errors. */
const PROVIDER_DETAIL_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;
const PROVIDER_DETAIL_SCHEMA_VERSION = "provider-sections-v2";

/**
 * Non-enumerable key on thrown `Error` instances so callers can tell which provider
 * the failure belonged to (used to avoid showing stale toasts across selections).
 */
const TAGGED_ERROR_PROVIDER_ID_KEY = "providerId";

type ProviderDetailHookReturn = {
  detail?: ProviderDetailData;
  isLoading: boolean;
  error?: Error;
  revalidate: () => void;
};

export function useProviderDetail(binary?: ResolvedCodexBarBinary, providerId?: string): ProviderDetailHookReturn {
  const {
    data: cachedDetail,
    error: fetchError,
    isLoading,
    revalidate,
  } = useCachedPromise(fetchProviderDetailWithTaggedErrors, [binary, providerId, PROVIDER_DETAIL_SCHEMA_VERSION], {
    keepPreviousData: true,
  });

  const detailForActiveSelection =
    cachedDetail && providerId && cachedDetail.id === providerId && isProviderDetailSchemaCurrent(cachedDetail)
      ? cachedDetail
      : undefined;

  const cacheIsFreshEnoughToMaskError = detailForActiveSelection
    ? isProviderDetailStillFresh(detailForActiveSelection)
    : false;

  const refetchErroredAndCacheIsStale = Boolean(fetchError && !cacheIsFreshEnoughToMaskError);

  const errorProviderIdFromTag = readTaggedProviderIdFromError(fetchError);
  const fetchErrorAppliesToActiveSelection = !errorProviderIdFromTag || errorProviderIdFromTag === providerId;

  return {
    detail: refetchErroredAndCacheIsStale ? undefined : detailForActiveSelection,
    isLoading,
    error: refetchErroredAndCacheIsStale && fetchErrorAppliesToActiveSelection ? fetchError : undefined,
    revalidate,
  };
}

async function fetchProviderDetailWithTaggedErrors(
  resolvedBinary?: ResolvedCodexBarBinary,
  selectedProviderId?: string,
  schemaVersion?: string,
): Promise<ProviderDetailData | undefined> {
  void schemaVersion;

  if (!resolvedBinary || !selectedProviderId) {
    return undefined;
  }

  try {
    return await fetchProviderDetail(resolvedBinary, selectedProviderId);
  } catch (caughtError) {
    throw tagFetchErrorWithProviderId(caughtError, selectedProviderId);
  }
}

function isProviderDetailSchemaCurrent(detail: ProviderDetailData): boolean {
  return detail.sections.every((section) => {
    const kind = Reflect.get(section, "kind");
    return (
      kind === "usage" ||
      kind === "supplementalUsage" ||
      kind === "credits" ||
      kind === "providerCost" ||
      kind === "info"
    );
  });
}

function isProviderDetailStillFresh(detail: ProviderDetailData, now = Date.now()): boolean {
  const fetchedAtMs = Date.parse(detail.fetchedAt);
  if (Number.isNaN(fetchedAtMs)) {
    return false;
  }

  return now - fetchedAtMs <= PROVIDER_DETAIL_FRESHNESS_WINDOW_MS;
}

function tagFetchErrorWithProviderId(error: unknown, providerId: string): Error {
  if (error instanceof Error) {
    Object.defineProperty(error, TAGGED_ERROR_PROVIDER_ID_KEY, {
      value: providerId,
      configurable: true,
      enumerable: false,
      writable: true,
    });
    return error;
  }

  const wrapped = new Error(String(error));
  Object.defineProperty(wrapped, TAGGED_ERROR_PROVIDER_ID_KEY, {
    value: providerId,
    configurable: true,
    enumerable: false,
    writable: true,
  });
  return wrapped;
}

function readTaggedProviderIdFromError(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const taggedId = Reflect.get(error, TAGGED_ERROR_PROVIDER_ID_KEY);
  return typeof taggedId === "string" && taggedId.length > 0 ? taggedId : undefined;
}
