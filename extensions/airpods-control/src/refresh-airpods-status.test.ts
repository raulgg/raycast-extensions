import { LaunchType, type LaunchProps } from "@raycast/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAirPodsStatusSubtitles, runAirPodsStatusRefresh } from "./core/airpods-status-refresh";
import { runWithCliGuard } from "./core/cli-guard";
import main from "./refresh-airpods-status";

vi.mock("./core/airpods-status-refresh", () => ({
  resetAirPodsStatusSubtitles: vi.fn(),
  runAirPodsStatusRefresh: vi.fn(),
}));

vi.mock("./core/cli-guard", () => ({
  runWithCliGuard: vi.fn(async (perform: () => Promise<void>) => perform()),
}));

function props(launchType: LaunchType = LaunchType.UserInitiated): LaunchProps {
  return { launchType, arguments: undefined } as unknown as LaunchProps;
}

describe("Refresh AirPods Status entry point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the interactive CLI guard and shows feedback for a manual refresh", async () => {
    await main(props());

    expect(runWithCliGuard).toHaveBeenCalledWith(expect.any(Function), {
      onUnavailable: resetAirPodsStatusSubtitles,
    });
    expect(runAirPodsStatusRefresh).toHaveBeenCalledWith({ showFeedback: true });
  });

  it("runs silently in the background without opening setup", async () => {
    await main(props(LaunchType.Background));

    expect(runAirPodsStatusRefresh).toHaveBeenCalledWith({ showFeedback: false });
    expect(runWithCliGuard).not.toHaveBeenCalled();
    expect(resetAirPodsStatusSubtitles).not.toHaveBeenCalled();
  });
});
