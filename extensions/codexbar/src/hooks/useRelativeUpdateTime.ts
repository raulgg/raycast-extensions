import { useEffect, useRef, useState } from "react";
import { getRelativeUpdateTimeRefreshDelay } from "../lib/presentation";

export function useRelativeUpdateTime(updatedAt?: string, enabled = true): number | undefined {
  const [now, setNow] = useState<number>();

  useEffect(() => {
    if (!enabled || !updatedAt) {
      setNow(undefined);
      return;
    }

    setNow(Date.now());
  }, [enabled, updatedAt]);

  const refreshDelay =
    enabled && updatedAt && typeof now === "number" ? getRelativeUpdateTimeRefreshDelay(updatedAt, now) : undefined;

  useTimeout(() => {
    setNow(Date.now());
  }, refreshDelay ?? null);

  return now;
}

function useTimeout(callback: () => void, delay: number | null): void {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) {
      return;
    }

    const timeoutId = setTimeout(() => {
      savedCallback.current();
    }, delay);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [delay]);
}
