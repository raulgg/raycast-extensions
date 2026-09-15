import { LaunchType, type LaunchProps } from "@raycast/api";
import { expect, vi, test } from "vitest";
import main from "./refresh-airpods-status";
import { runWithCliGuard } from "./setup/guard";
import { resetAirPodsStatusSubtitles, runAirPodsStatusRefresh } from "./status/refresh";

vi.mock("./status/refresh", () => ({
  resetAirPodsStatusSubtitles: vi.fn(),
  runAirPodsStatusRefresh: vi.fn(),
}));

vi.mock("./setup/guard", () => ({
  runWithCliGuard: vi.fn(async (perform: () => Promise<void>) => perform()),
}));

function props(launchType: LaunchType = LaunchType.UserInitiated): LaunchProps {
  return { launchType, arguments: undefined } as unknown as LaunchProps;
}

test("uses the interactive CLI guard and shows feedback for a manual refresh", async () => {
  // Given
  const launch = props();
  // When
  await main(launch);
  // Then
  expect(runWithCliGuard).toHaveBeenCalledWith(expect.any(Function), {
    onUnavailable: resetAirPodsStatusSubtitles,
  });
  expect(runAirPodsStatusRefresh).toHaveBeenCalledWith({ showFeedback: true });
});

test("runs silently in the background without opening setup", async () => {
  // Given
  const launch = props(LaunchType.Background);
  // When
  await main(launch);
  // Then
  expect(runAirPodsStatusRefresh).toHaveBeenCalledWith({ showFeedback: false });
  expect(runWithCliGuard).not.toHaveBeenCalled();
  expect(resetAirPodsStatusSubtitles).not.toHaveBeenCalled();
});
