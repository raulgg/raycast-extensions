import { getMockProviderPayload, isCodexBarMockMode } from "../mocks/codexbar";
import { readProviderStatuses } from "../lib/providerStatusCache";
import { extractProviderStatus } from "../providers/normalize";
import type { ProviderStatus } from "../providers/types";

// Foreground read of the provider-status cache the background refresh warms.
// When the background refresh is disabled the cache stays empty and no badges
// appear — graceful absence, no lazy foreground statuspage fetch. In mock mode
// the cache is never written, so status is derived straight from mock payloads
// to keep dev-mode badges working.
//
// Read on every render rather than memoizing on the provider ids: the cache is a
// cheap synchronous read, and background refreshes write to it while the list is
// mounted. Keying a memo on the ids would freeze the first read, so a newly
// warmed (or cleared) badge would never surface until the component remounted.
// UsageList already re-renders on relative-time ticks and detail updates, so
// each of those naturally picks up the latest cached status.
export function useProviderStatuses(providerIds: string[]): Record<string, ProviderStatus> {
  if (isCodexBarMockMode()) {
    return buildMockProviderStatuses(providerIds);
  }

  return readProviderStatuses(providerIds);
}

function buildMockProviderStatuses(providerIds: string[]): Record<string, ProviderStatus> {
  return Object.fromEntries(
    providerIds.flatMap((providerId) => {
      const status = extractProviderStatus(getMockProviderPayload(providerId), providerId);
      return status ? [[providerId, status]] : [];
    }),
  );
}
