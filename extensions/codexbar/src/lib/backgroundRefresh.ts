import { getMockConfiguredProviders, isCodexBarMockMode } from "../mocks/codexbar";
import type { ConfiguredProvider } from "../providers/types";
import { cacheProviderDetailIfRicher, runProviderDetailFetches } from "../hooks/useProviderDetails";
import { cacheProviderStatus, readProviderStatus } from "./providerStatusCache";
import {
  ensureCodexBarServe,
  fetchProviderDetailFromServe,
  fetchProviderDetailFromUsageCommand,
  fetchProviderStatusFromUsageCommand,
  fetchProviderUsageWithStatus,
  getCodexBarAvailability,
  readConfiguredProvidersFromConfig,
  type ProviderUsageWithStatus,
  type ResolvedCodexBarBinary,
} from "./codexbar";

const BACKGROUND_PROVIDER_DETAIL_CONCURRENCY = 4;

export type UsageCacheRefreshError = {
  providerId?: string;
  message: string;
};

export type UsageCacheRefreshResult =
  | {
      status: "completed";
      providerCount: number;
      refreshedCount: number;
      unchangedCount: number;
      errorCount: number;
      errors: UsageCacheRefreshError[];
      usedServe: boolean;
    }
  | {
      status: "skipped";
      reason: string;
      errors: UsageCacheRefreshError[];
    };

export async function refreshUsageCache(): Promise<UsageCacheRefreshResult> {
  const availability = await getCodexBarAvailability();
  if (availability.status !== "available") {
    return {
      status: "skipped",
      reason: availability.status === "unavailable" ? "codexbar-unavailable" : "codexbar-error",
      errors: [
        {
          message:
            availability.status === "unavailable"
              ? (availability.error?.message ?? "CodexBar CLI is unavailable.")
              : availability.error.message,
        },
      ],
    };
  }

  let providers: ConfiguredProvider[];
  try {
    providers = await readBackgroundConfiguredProviders(availability.binary);
  } catch (error) {
    return {
      status: "skipped",
      reason: "config-error",
      errors: [{ message: toErrorMessage(error) }],
    };
  }

  const providerIds = providers.map((provider) => provider.id).filter(Boolean);
  if (providerIds.length === 0) {
    return {
      status: "completed",
      providerCount: 0,
      refreshedCount: 0,
      unchangedCount: 0,
      errorCount: 0,
      errors: [],
      usedServe: false,
    };
  }

  const usedServe =
    availability.binary.source !== "mock" && !isCodexBarMockMode()
      ? await ensureCodexBarServe(availability.binary)
      : false;
  const errors: UsageCacheRefreshError[] = [];
  let refreshedCount = 0;
  let unchangedCount = 0;

  await runProviderDetailFetches({
    providerIds,
    concurrency: BACKGROUND_PROVIDER_DETAIL_CONCURRENCY,
    fetchProvider: async (providerId) => {
      try {
        const { detail, status } = await fetchProviderDetailAndStatusForBackground(
          availability.binary,
          providerId,
          usedServe,
        );
        if (cacheProviderDetailIfRicher(detail)) {
          refreshedCount += 1;
        } else {
          unchangedCount += 1;
        }
        // Status is best-effort: it must never fail the usage refresh. When this
        // refresh could not obtain a fresh status we leave the existing cache
        // entry untouched (the `if (status)` skip), so a previously cached
        // incident keeps showing until its 30-min TTL lapses. We deliberately do
        // not clear the cache on a miss — flicker on flaky networks is worse than
        // a slightly stale, TTL-bounded badge.
        if (status) {
          cacheProviderStatus(providerId, status);
        }
      } catch (error) {
        errors.push({ providerId, message: toErrorMessage(error) });
      }
    },
  });

  return {
    status: "completed",
    providerCount: providerIds.length,
    refreshedCount,
    unchangedCount,
    errorCount: errors.length,
    errors,
    usedServe,
  };
}

async function readBackgroundConfiguredProviders(binary: ResolvedCodexBarBinary): Promise<ConfiguredProvider[]> {
  if (binary.source === "mock" || isCodexBarMockMode()) {
    return getMockConfiguredProviders();
  }

  return readConfiguredProvidersFromConfig();
}

// Detail keeps its serve-preferred path (ADR-0002); status is layered on top.
// Upstream's serve mode never carries status, so when serve supplies the detail
// we take status from a dedicated best-effort `usage --status` one-shot (only
// when the cached status has aged out — see fetchProviderStatusSafely). When
// serve is unavailable we run a single `usage --status` that returns both detail
// and status, falling back to a plain detail fetch on older CLIs.
async function fetchProviderDetailAndStatusForBackground(
  binary: ResolvedCodexBarBinary,
  providerId: string,
  preferServe: boolean,
): Promise<ProviderUsageWithStatus> {
  if (preferServe) {
    try {
      const detail = await fetchProviderDetailFromServe(binary, providerId);
      const status = await fetchProviderStatusSafely(binary, providerId);
      return { detail, status };
    } catch {
      return fetchProviderUsageWithStatusOrDetailOnly(binary, providerId);
    }
  }

  return fetchProviderUsageWithStatusOrDetailOnly(binary, providerId);
}

// `usage --status` yields detail and status in one call, but a CLI that predates
// the --status flag exits nonzero ("Unknown option") — which would take the
// usage detail down along with the status. Status must never fail the usage
// refresh, so fall back to a plain detail fetch (status undefined) when the
// combined call fails. A genuine provider-error payload makes both calls throw,
// so real errors still surface to the caller.
async function fetchProviderUsageWithStatusOrDetailOnly(
  binary: ResolvedCodexBarBinary,
  providerId: string,
): Promise<ProviderUsageWithStatus> {
  try {
    return await fetchProviderUsageWithStatus(binary, providerId);
  } catch {
    const detail = await fetchProviderDetailFromUsageCommand(binary, providerId);
    return { detail, status: undefined };
  }
}

async function fetchProviderStatusSafely(
  binary: ResolvedCodexBarBinary,
  providerId: string,
): Promise<ProviderUsageWithStatus["status"]> {
  // Status has a 30-min TTL but this refresh runs every ~5 min, so ~5 of every 6
  // serve-path status one-shots would spawn a CLI only to re-store an unchanged
  // value. Skip the fetch while the cached status is still fresh (readProviderStatus
  // returns undefined for missing or expired entries); returning undefined here
  // leaves that fresh cache entry in place via the caller's `if (status)` guard.
  if (readProviderStatus(providerId) !== undefined) {
    return undefined;
  }

  try {
    return await fetchProviderStatusFromUsageCommand(binary, providerId);
  } catch {
    return undefined;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
