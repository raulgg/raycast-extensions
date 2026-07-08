import { useCachedPromise } from "@raycast/utils";
import type { ResolvedCodexBarBinary } from "../lib/codexbar";
import { listAvailableProviders } from "../lib/providerConfig";
import type { AvailableProvider } from "../providers/types";

type UseAvailableProvidersResult = {
  providers: AvailableProvider[];
  isLoading: boolean;
  error?: Error;
  revalidate: () => Promise<void>;
};

export function useAvailableProviders(binary?: ResolvedCodexBarBinary): UseAvailableProvidersResult {
  const { data, error, isLoading, revalidate } = useCachedPromise(
    async (resolvedBinary?: ResolvedCodexBarBinary) => {
      if (!resolvedBinary) {
        return [];
      }

      return listAvailableProviders(resolvedBinary);
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
    revalidate: async () => {
      await revalidate();
    },
  };
}
