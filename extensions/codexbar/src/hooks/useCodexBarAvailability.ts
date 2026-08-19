import { useCachedPromise } from "@raycast/utils";
import { getCodexBarAvailability, type CodexBarAvailability } from "../lib/codexbar";
import { getKeychainAccessPolicy } from "../preferences";

type UseCodexBarAvailabilityResult = {
  availability?: CodexBarAvailability;
  isLoading: boolean;
  error?: Error;
  revalidate: () => void;
};

export function useCodexBarAvailability(): UseCodexBarAvailabilityResult {
  const keychainAccessPolicy = getKeychainAccessPolicy();
  const { data, error, isLoading, revalidate } = useCachedPromise(getCodexBarAvailability, [keychainAccessPolicy], {
    // Never expose a binary resolved under the previous policy while a
    // preference change is being revalidated.
    keepPreviousData: false,
  });

  return {
    availability: data,
    isLoading,
    error,
    revalidate,
  };
}
