import { launchCommand, LaunchType } from "@raycast/api";
import { expect, vi, test } from "vitest";
import { isCliInstalled } from "../cli/discovery";
import { CYCLE_LISTENING_MODE_COMMAND_NAME } from "../commands/names";
import { promptForCliInstallation } from "../setup/installation";
import { expectConsoleWarning } from "../test/console";
import { setListeningMode } from "./delegate-listening-mode";
import { runSetListeningModeCommand } from "./listening-mode";

vi.mock("./listening-mode", () => ({
  runSetListeningModeCommand: vi.fn(),
}));

vi.mock("../cli/discovery", () => ({ isCliInstalled: vi.fn() }));

vi.mock("../setup/installation", () => ({ promptForCliInstallation: vi.fn() }));

const mockLaunchCommand = vi.mocked(launchCommand);

test("delegates a fixed set to Cycle with typed context", async () => {
  // Given
  mockLaunchCommand.mockReset().mockResolvedValue(undefined);
  vi.mocked(isCliInstalled).mockReturnValue(true);
  vi.mocked(promptForCliInstallation).mockReset().mockResolvedValue(undefined);
  // When
  await setListeningMode("adaptive");
  // Then
  expect(mockLaunchCommand).toHaveBeenCalledWith({
    name: CYCLE_LISTENING_MODE_COMMAND_NAME,
    type: LaunchType.UserInitiated,
    context: { operation: "set", mode: "adaptive" },
  });
  expect(promptForCliInstallation).not.toHaveBeenCalled();
  expect(runSetListeningModeCommand).not.toHaveBeenCalled();
});

test("uses the guarded CLI workflow when Cycle cannot be launched", async () => {
  // Given
  mockLaunchCommand.mockReset().mockResolvedValue(undefined);
  vi.mocked(isCliInstalled).mockReturnValue(true);
  vi.mocked(promptForCliInstallation).mockReset().mockResolvedValue(undefined);
  const error = new Error("disabled");
  expectConsoleWarning("Could not delegate to Cycle Listening Mode; using the CLI fallback", error);
  mockLaunchCommand.mockRejectedValue(error);
  // When
  await setListeningMode("anc");
  // Then
  expect(promptForCliInstallation).not.toHaveBeenCalled();
  expect(runSetListeningModeCommand).toHaveBeenCalledWith("anc", { updateCycleSubtitle: false });
});

test.each(["anc", "transparency", "adaptive", "off"] as const)(
  "owns missing-CLI setup for %s without delegating or starting a second installer",
  async (mode) => {
    // Given
    mockLaunchCommand.mockReset().mockResolvedValue(undefined);
    vi.mocked(isCliInstalled).mockReturnValue(true);
    vi.mocked(promptForCliInstallation).mockReset().mockResolvedValue(undefined);
    vi.useFakeTimers();
    try {
      vi.mocked(isCliInstalled).mockReturnValue(false);
      let finishInstallation!: () => void;
      vi.mocked(promptForCliInstallation).mockReturnValue(
        new Promise<void>((resolve) => {
          finishInstallation = resolve;
        }),
      );
      // When
      const running = setListeningMode(mode);
      await vi.advanceTimersByTimeAsync(6000);
      // Then
      expect(promptForCliInstallation).toHaveBeenCalledOnce();
      expect(mockLaunchCommand).not.toHaveBeenCalled();
      expect(runSetListeningModeCommand).not.toHaveBeenCalled();
      vi.mocked(isCliInstalled).mockReturnValue(true);
      finishInstallation();
      // When
      await running;
      // Then
      expect(mockLaunchCommand).not.toHaveBeenCalled();
      expect(runSetListeningModeCommand).not.toHaveBeenCalled();
      // When
      await setListeningMode(mode);
      // Then
      expect(mockLaunchCommand).toHaveBeenCalledExactlyOnceWith({
        name: CYCLE_LISTENING_MODE_COMMAND_NAME,
        type: LaunchType.UserInitiated,
        context: { operation: "set", mode },
      });
      expect(promptForCliInstallation).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  },
);
