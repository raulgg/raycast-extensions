import { showToast, Toast } from "@raycast/api";
import { useEffect, useRef } from "react";

type UseProviderDetailErrorToastOptions = {
  error?: Error;
  providerId?: string;
  providerName?: string;
  onRetry: () => void;
};

export function useProviderDetailErrorToast({
  error,
  providerId,
  providerName,
  onRetry,
}: UseProviderDetailErrorToastOptions) {
  const lastToastKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!error || !providerId) {
      lastToastKeyRef.current = undefined;
      return;
    }

    const toastKey = `${providerId}:${error.message}`;
    if (lastToastKeyRef.current === toastKey) {
      return;
    }

    lastToastKeyRef.current = toastKey;

    void showToast({
      style: Toast.Style.Failure,
      title: `Failed to load ${providerName ?? providerId} usage`,
      message: error.message,
      primaryAction: {
        title: "Retry",
        onAction: () => onRetry(),
      },
    });
  }, [error, onRetry, providerId, providerName]);
}
