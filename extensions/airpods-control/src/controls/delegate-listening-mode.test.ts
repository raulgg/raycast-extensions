import { launchCommand, LaunchType } from "@raycast/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCliInstalled } from "../cli/transport";
import { CYCLE_LISTENING_MODE_COMMAND_NAME } from "../commands/names";
import { promptForCliInstallation } from "../helper-setup/installation";
import { runSetListeningModeCommand } from "./airpods-control";
import { setListeningMode } from "./delegate-listening-mode";

vi.mock("./airpods-control", () => ({
  runSetListeningModeCommand: vi.fn(),
}));

vi.mock("../cli/transport", () => ({ isCliInstalled: vi.fn() }));
vi.mock("../helper-setup/installation", () => ({ promptForCliInstallation: vi.fn() }));

const mockLaunchCommand = vi.mocked(launchCommand);

describe("listening-mode command gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLaunchCommand.mockReset().mockResolvedValue(undefined);
    vi.mocked(isCliInstalled).mockReturnValue(true);
    vi.mocked(promptForCliInstallation).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates a fixed set to Cycle with typed context", async () => {
    await setListeningMode("adaptive");

    expect(mockLaunchCommand).toHaveBeenCalledWith({
      name: CYCLE_LISTENING_MODE_COMMAND_NAME,
      type: LaunchType.UserInitiated,
      context: { operation: "set", mode: "adaptive" },
    });
    expect(promptForCliInstallation).not.toHaveBeenCalled();
    expect(runSetListeningModeCommand).not.toHaveBeenCalled();
  });

  it("uses the guarded CLI workflow when Cycle cannot be launched", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockLaunchCommand.mockRejectedValue(new Error("disabled"));

    await setListeningMode("anc");

    expect(promptForCliInstallation).not.toHaveBeenCalled();
    expect(runSetListeningModeCommand).toHaveBeenCalledWith("anc", { updateCycleSubtitle: false });
  });

  it.each(["anc", "transparency", "adaptive", "off"] as const)(
    "owns missing-CLI setup for %s without delegating or starting a second installer",
    async (mode) => {
      vi.useFakeTimers();
      try {
        vi.mocked(isCliInstalled).mockReturnValue(false);
        let finishInstallation!: () => void;
        vi.mocked(promptForCliInstallation).mockReturnValue(
          new Promise<void>((resolve) => {
            finishInstallation = resolve;
          }),
        );

        const running = setListeningMode(mode);
        await vi.advanceTimersByTimeAsync(6000);
        expect(promptForCliInstallation).toHaveBeenCalledOnce();
        expect(mockLaunchCommand).not.toHaveBeenCalled();
        expect(runSetListeningModeCommand).not.toHaveBeenCalled();

        vi.mocked(isCliInstalled).mockReturnValue(true);
        finishInstallation();
        await running;
        expect(mockLaunchCommand).not.toHaveBeenCalled();
        expect(runSetListeningModeCommand).not.toHaveBeenCalled();

        await setListeningMode(mode);
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
});
