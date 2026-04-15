import { useCachedPromise } from "@raycast/utils";
import { getCodexBarAvailability, type CodexBarAvailability } from "../lib/codexbar";

type UseCodexBarAvailabilityResult = {
  availability?: CodexBarAvailability;
  isLoading: boolean;
  error?: Error;
  revalidate: () => void;
};

export function useCodexBarAvailability(): UseCodexBarAvailabilityResult {
  const { data, error, isLoading, revalidate } = useCachedPromise(getCodexBarAvailability, [], {
    keepPreviousData: true,
  });

  return {
    availability: data,
    isLoading,
    error,
    revalidate,
  };
}
