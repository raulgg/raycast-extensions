import { useCachedPromise } from "@raycast/utils";
import type { ResolvedCodexBarBinary } from "../lib/codexbar";
import { readConfiguredProvidersFromConfig } from "../lib/providerConfig";
import { getMockConfiguredProviders, isCodexBarMockMode } from "../mocks/codexbar";
import type { ConfiguredProvider } from "../providers/types";

type UseUsageOverviewResult = {
  providers: ConfiguredProvider[];
  isLoading: boolean;
  error?: Error;
  revalidate: () => void;
};

export function useUsageOverview(binary?: ResolvedCodexBarBinary): UseUsageOverviewResult {
  const { data, error, isLoading, revalidate } = useCachedPromise(
    async (resolvedBinary?: ResolvedCodexBarBinary) => {
      if (!resolvedBinary) {
        return [];
      }

      if (resolvedBinary.source === "mock" || isCodexBarMockMode()) {
        return getMockConfiguredProviders();
      }

      return readConfiguredProvidersFromConfig();
    },
    [binary],
    {
      keepPreviousData: true,
    },
  );

  return {
    providers: data ?? [],
    isLoading,
    error,
    revalidate,
  };
}
