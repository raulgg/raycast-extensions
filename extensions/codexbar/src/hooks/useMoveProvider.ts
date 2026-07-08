import { showToast, Toast } from "@raycast/api";
import { useCallback, useRef } from "react";
import { moveConfiguredProviderInConfig, type ProviderMoveDirection } from "../lib/providerConfig";

// Shared reorder handler over the CodexBar config. Serializes calls through a
// busy ref so overlapping writes can't clobber each other; pass a shared ref to
// also exclude other config writers on the same view (e.g. provider toggles).
// `onMoved` runs only when the config actually changed.
export function useMoveProvider(
  onMoved: (providerId: string) => void,
  busyRef?: { current: boolean },
): (providerId: string, direction: ProviderMoveDirection) => Promise<void> {
  const internalBusyRef = useRef(false);
  const activeBusyRef = busyRef ?? internalBusyRef;

  return useCallback(
    async (providerId: string, direction: ProviderMoveDirection) => {
      if (activeBusyRef.current) {
        return;
      }
      activeBusyRef.current = true;

      try {
        const didMove = await moveConfiguredProviderInConfig(providerId, direction);
        if (!didMove) {
          return;
        }

        onMoved(providerId);
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to Reorder Providers",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        activeBusyRef.current = false;
      }
    },
    [onMoved, activeBusyRef],
  );
}
