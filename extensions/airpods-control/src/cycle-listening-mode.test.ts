import { LaunchType, type LaunchProps } from "@raycast/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  publishListeningModeSubtitle,
  refreshListeningModeSubtitle,
  runCycleListeningModeCommand,
  runSetListeningModeCommand,
} from "./controls/airpods-control";
import main from "./cycle-listening-mode";
import { runWithCliGuard } from "./helper-setup/guard";
import { resetCommandSubtitle } from "./subtitles/coordination";
import type { SetListeningModeLaunchContext } from "./controls/delegate-listening-mode";
import type { ListeningModeSubtitleRefreshContext } from "./status/refresh";

vi.mock("./controls/airpods-control", () => ({
  publishListeningModeSubtitle: vi.fn(),
  refreshListeningModeSubtitle: vi.fn(),
  runCycleListeningModeCommand: vi.fn(),
  runSetListeningModeCommand: vi.fn(),
}));

vi.mock("./helper-setup/guard", () => ({
  runWithCliGuard: vi.fn(async (perform: () => Promise<void>) => perform()),
}));

vi.mock("./subtitles/coordination", () => ({
  resetCommandSubtitle: vi.fn(),
}));

type Props = LaunchProps<{
  launchContext?: SetListeningModeLaunchContext | ListeningModeSubtitleRefreshContext;
}>;

function props(
  launchContext?: SetListeningModeLaunchContext | ListeningModeSubtitleRefreshContext,
  launchType: LaunchType = LaunchType.UserInitiated,
): Props {
  return { launchType, arguments: undefined, launchContext } as unknown as Props;
}

describe("Cycle Listening Mode entry point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves the current subtitle while starting a normal cycle", async () => {
    await main(props());

    expect(refreshListeningModeSubtitle).not.toHaveBeenCalled();
    expect(resetCommandSubtitle).not.toHaveBeenCalled();
    expect(runWithCliGuard).toHaveBeenCalledOnce();
    expect(runWithCliGuard).toHaveBeenCalledWith(expect.any(Function), {
      onUnavailable: expect.any(Function),
    });
    expect(runCycleListeningModeCommand).toHaveBeenCalledOnce();
    expect(runSetListeningModeCommand).not.toHaveBeenCalled();
  });

  it("falls back to a read-only refresh for a background launch without refresh context", async () => {
    await main(props({ operation: "set", mode: "transparency" }, LaunchType.Background));

    expect(refreshListeningModeSubtitle).toHaveBeenCalledOnce();
    expect(publishListeningModeSubtitle).not.toHaveBeenCalled();
    expect(runWithCliGuard).not.toHaveBeenCalled();
    expect(runCycleListeningModeCommand).not.toHaveBeenCalled();
    expect(runSetListeningModeCommand).not.toHaveBeenCalled();
  });

  it("publishes coordinator state during a background launch without reading or cycling", async () => {
    await main(
      props(
        { operation: "refresh-listening-mode-subtitle", mode: "anc", revision: "read-revision" },
        LaunchType.Background,
      ),
    );

    expect(publishListeningModeSubtitle).toHaveBeenCalledWith("anc", "read-revision");
    expect(refreshListeningModeSubtitle).not.toHaveBeenCalled();
    expect(runWithCliGuard).not.toHaveBeenCalled();
    expect(runCycleListeningModeCommand).not.toHaveBeenCalled();
    expect(runSetListeningModeCommand).not.toHaveBeenCalled();
  });

  it("resets the coordinator-owned subtitle during a background launch", async () => {
    await main(
      props(
        { operation: "refresh-listening-mode-subtitle", mode: null, revision: "read-revision" },
        LaunchType.Background,
      ),
    );

    expect(publishListeningModeSubtitle).toHaveBeenCalledWith(null, "read-revision");
    expect(runCycleListeningModeCommand).not.toHaveBeenCalled();
    expect(runSetListeningModeCommand).not.toHaveBeenCalled();
  });

  it("performs a single delegated set without cycling", async () => {
    await main(props({ operation: "set", mode: "transparency" }));

    expect(resetCommandSubtitle).not.toHaveBeenCalled();
    expect(runSetListeningModeCommand).toHaveBeenCalledWith("transparency", { updateCycleSubtitle: true });
    expect(runCycleListeningModeCommand).not.toHaveBeenCalled();
  });

  it("rejects invalid programmatic context without changing a mode", async () => {
    const invalid = { operation: "set", mode: "future" } as unknown as SetListeningModeLaunchContext;

    await expect(main(props(invalid))).rejects.toThrow("invalid launch context");

    expect(resetCommandSubtitle).toHaveBeenCalledWith({ channel: "listening-mode" });
    expect(runCycleListeningModeCommand).not.toHaveBeenCalled();
    expect(runSetListeningModeCommand).not.toHaveBeenCalled();
  });

  it("never treats subtitle-refresh context as a user-initiated set", async () => {
    await expect(
      main(props({ operation: "refresh-listening-mode-subtitle", mode: "adaptive", revision: "read-revision" })),
    ).rejects.toThrow("invalid launch context");

    expect(resetCommandSubtitle).toHaveBeenCalledWith({ channel: "listening-mode" });
    expect(runCycleListeningModeCommand).not.toHaveBeenCalled();
    expect(runSetListeningModeCommand).not.toHaveBeenCalled();
  });
});
