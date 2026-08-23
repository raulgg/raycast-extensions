import { Cache, launchCommand, LaunchType, showToast, Toast } from "@raycast/api";

const REFRESH_USAGE_CACHE_NAMESPACE = "refresh-usage-cache";
const ARMED_KEY = "armed-v1";
const ARMED_VALUE = "1";

let refreshUsageCacheStateCache: Cache | undefined;

function getRefreshUsageCacheStateCache(): Cache {
  refreshUsageCacheStateCache ??= new Cache({ namespace: REFRESH_USAGE_CACHE_NAMESPACE });
  return refreshUsageCacheStateCache;
}

function isRefreshUsageCacheArmed(): boolean {
  return getRefreshUsageCacheStateCache().get(ARMED_KEY) === ARMED_VALUE;
}

export function recordRefreshUsageCacheSuccess(): void {
  getRefreshUsageCacheStateCache().set(ARMED_KEY, ARMED_VALUE);
}

export async function launchRefreshUsageCacheIfNeeded(): Promise<boolean> {
  try {
    if (isRefreshUsageCacheArmed()) {
      return false;
    }

    await launchCommand({ name: "refresh-usage-cache", type: LaunchType.UserInitiated });
    return true;
  } catch (error) {
    try {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to Start Background Refresh",
        message: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Usage Overview must still render if the toast itself fails.
    }
    return false;
  }
}
