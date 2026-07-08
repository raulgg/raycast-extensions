import { getMockProviderPayload, isCodexBarMockMode } from "../mocks/codexbar";
import { readProviderStatuses } from "../lib/providerStatusCache";
import { extractProviderStatus } from "../providers/normalize";
import type { ProviderStatus } from "../providers/types";

// Live read of background-warmed status cache. No memo: keeps badges fresh when cache updates.
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
