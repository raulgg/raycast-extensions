import { useCachedPromise } from "@raycast/utils";
import { readConfiguredProvidersFromConfig, type ResolvedCodexBarBinary } from "../lib/codexbar";
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
