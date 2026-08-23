import { updateCommandMetadata } from "@raycast/api";
import { refreshUsageCache } from "./lib/backgroundRefresh";
import { recordRefreshUsageCacheSuccess } from "./lib/refreshUsageCacheLaunch";

export default async function Command() {
  // Development reinstalls keep a custom subtitle until it is cleared.
  await updateCommandMetadata({ subtitle: null });

  const result = await refreshUsageCache();
  if (result.status === "completed") {
    recordRefreshUsageCacheSuccess();
  }
}
