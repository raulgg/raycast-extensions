import { updateCommandMetadata } from "@raycast/api";
import { refreshUsageCache } from "./lib/backgroundRefresh";

export default async function Command() {
  // Development reinstalls keep a custom subtitle until it is cleared.
  await updateCommandMetadata({ subtitle: null });

  await refreshUsageCache();
}
