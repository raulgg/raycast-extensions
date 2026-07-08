import { useCachedPromise } from "@raycast/utils";
import type { ResolvedCodexBarBinary } from "../lib/codexbar";
import { listAvailableProviders } from "../lib/providerConfig";
import type { AvailableProvider } from "../providers/types";

type UseAvailableProvidersResult = {
  providers: AvailableProvider[];
  isLoading: boolean;
  error?: Error;
  // Awaitable so callers can wait for the refreshed roster before clearing UI
  // state (e.g. a pending indicator) and avoid a flash of stale data.
  revalidate: () => Promise<void>;
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
    revalidate: async () => {
      await revalidate();
    },
  };
}
