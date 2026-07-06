import { Cache } from "@raycast/api";
import { isProviderStatusFresh } from "../providers/status";
import type { ProviderStatus } from "../providers/types";

// Provider status lives in its own cache namespace, distinct from the
// provider-detail (usage) cache. Serve-sourced usage writes never carry status,
// so keeping the two apart stops a usage refresh from clobbering status (and
// vice versa). See docs/adr/0003-provider-status-cli-only.md.
const PROVIDER_STATUS_SCHEMA_VERSION = "provider-status-v1";
const providerStatusCache = new Cache({ namespace: "provider-status" });

type CachedProviderStatus = {
  status: ProviderStatus;
  fetchedAt: string;
};

export function cacheProviderStatus(providerId: string, status: ProviderStatus, now = Date.now()): void {
  const cached: CachedProviderStatus = {
    status,
    fetchedAt: new Date(now).toISOString(),
  };
  providerStatusCache.set(buildProviderStatusCacheKey(providerId), JSON.stringify(cached));
}

export function readProviderStatus(providerId: string, now = Date.now()): ProviderStatus | undefined {
  const serialized = providerStatusCache.get(buildProviderStatusCacheKey(providerId));
  if (!serialized) {
    return undefined;
  }

  try {
    const cached = JSON.parse(serialized) as CachedProviderStatus;
    if (typeof cached.fetchedAt !== "string" || !isProviderStatusFresh(cached.fetchedAt, now)) {
      return undefined;
    }

    // cacheProviderStatus only ever stores an already-normalized ProviderStatus
    // under a schema-versioned key, so the value is returned as-is — re-parsing
    // it would be redundant work on the hot foreground read path.
    return cached.status;
  } catch {
    providerStatusCache.remove(buildProviderStatusCacheKey(providerId));
    return undefined;
  }
}

export function readProviderStatuses(providerIds: string[], now = Date.now()): Record<string, ProviderStatus> {
  return Object.fromEntries(
    providerIds.flatMap((providerId) => {
      const status = readProviderStatus(providerId, now);
      return status ? [[providerId, status]] : [];
    }),
  );
}

function buildProviderStatusCacheKey(providerId: string): string {
  return `${PROVIDER_STATUS_SCHEMA_VERSION}:${providerId}`;
}
