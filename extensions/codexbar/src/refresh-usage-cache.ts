import { refreshUsageCache } from "./lib/backgroundRefresh";

export default async function Command() {
  await refreshUsageCache();
}
