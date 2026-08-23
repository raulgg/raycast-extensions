import { useEffect } from "react";
import { UsageList } from "./components/UsageList";
import { launchRefreshUsageCacheIfNeeded } from "./lib/refreshUsageCacheLaunch";

export default function Command() {
  useEffect(() => {
    // Raycast enables the 5m interval only after a UserInitiated launch of that command.
    void launchRefreshUsageCacheIfNeeded();
  }, []);

  return <UsageList />;
}
