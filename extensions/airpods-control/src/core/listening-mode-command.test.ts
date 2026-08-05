import { launchCommand, LaunchType } from "@raycast/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSetListeningModeCommand } from "./airpods-control";
import { runWithCliGuard } from "./cli-guard";
import { CYCLE_LISTENING_MODE_COMMAND_NAME } from "./consts";
import { modeFromLaunchContext, setListeningMode } from "./listening-mode-command";

vi.mock("./airpods-control", () => ({
  runSetListeningModeCommand: vi.fn(),
}));

vi.mock("./cli-guard", () => ({
  runWithCliGuard: vi.fn(async (perform: () => Promise<void>) => perform()),
}));

const mockLaunchCommand = vi.mocked(launchCommand);

describe("listening-mode command gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(runWithCliGuard).not.toHaveBeenCalled();
    expect(runSetListeningModeCommand).not.toHaveBeenCalled();
  });

  it("uses the guarded CLI workflow when Cycle cannot be launched", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockLaunchCommand.mockRejectedValue(new Error("disabled"));

    await setListeningMode("anc");

    expect(runWithCliGuard).toHaveBeenCalledOnce();
    expect(runSetListeningModeCommand).toHaveBeenCalledWith("anc", { updateCycleSubtitle: false });
  });

  it.each([
    [{ operation: "set", mode: "off" }, "off"],
    [{ operation: "set", mode: "anc" }, "anc"],
    [{ operation: "set", mode: "transparency" }, "transparency"],
    [{ operation: "set", mode: "adaptive" }, "adaptive"],
  ] as const)("accepts valid launch context", (context, mode) => {
    expect(modeFromLaunchContext(context)).toBe(mode);
  });

  it.each([undefined, null, {}, { operation: "cycle", mode: "anc" }, { operation: "set", mode: "future" }])(
    "rejects invalid launch context %#",
    (context) => {
      expect(modeFromLaunchContext(context)).toBeNull();
    },
  );
});
