import { useCachedPromise } from "@raycast/utils";
import { listAvailableProviders, type ResolvedCodexBarBinary } from "../lib/codexbar";
import type { AvailableProvider } from "../providers/types";

type UseAvailableProvidersResult = {
  providers: AvailableProvider[];
  isLoading: boolean;
  error?: Error;
  revalidate: () => void;
};

// Loads the full Available Provider roster for the Manage Providers subview.
// An error here means the installed CLI is too old to expose `config providers`
// (or the lookup otherwise failed); the view capability-probes on that error and
// degrades gracefully rather than surfacing a raw failure.
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
    revalidate,
  };
}
