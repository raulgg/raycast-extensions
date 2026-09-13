import { spawn } from "child_process";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { environment, launchCommand, LaunchType, updateCommandMetadata } from "@raycast/api";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as AirPodsControlCli from "../../cli/client";
import { type ListeningModeSubtitleRefreshContext } from "../../commands/launch-context";
import { CYCLE_LISTENING_MODE_COMMAND_NAME, TOGGLE_CONVERSATION_AWARENESS_COMMAND_NAME } from "../../commands/names";
import { runSetListeningModeCommand, runToggleConversationAwarenessCommand } from "../../controls/airpods-control";
import cycleListeningMode from "../../cycle-listening-mode";
import { refreshAirPodsStatus } from "../../status/refresh";
import {
  publishCommandSubtitle,
  resetCommandSubtitle,
  reserveSubtitleRevisionForReset,
} from "../../subtitles/coordination";
import toggleConversationAwareness from "../../toggle-conversation-awareness";
import type { ListeningModes } from "../../airpods/types";

vi.mock("../../cli/client", () => ({
  confirmedConversationAwareness: vi.fn((payload) => payload?.conversationAwareness ?? null),
  confirmedListeningMode: vi.fn((payload) => {
    const modes: Record<string, ListeningModes> = {
      off: "off",
      transparency: "transparency",
      adaptive: "adaptive",
      "noise-cancellation": "anc",
    };
    return payload?.listeningMode ? (modes[payload.listeningMode] ?? null) : null;
  }),
  cycleListeningMode: vi.fn(),
  getConversationAwareness: vi.fn(),
  getListeningMode: vi.fn(),
  setConversationAwareness: vi.fn(),
  setListeningMode: vi.fn(),
}));

const mockLaunchCommand = vi.mocked(launchCommand);
const mockUpdateCommandMetadata = vi.mocked(updateCommandMetadata);

interface LaunchCall {
  name: string;
  context?: Record<string, unknown> | null;
}

function runLockf(path: string, timeout: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const lock = spawn("/usr/bin/lockf", ["-s", "-t", timeout, path, "/usr/bin/true"]);
    lock.once("error", reject);
    lock.once("close", (code) => resolve(code));
  });
}

function removeRevisionState(): void {
  rmSync(join(environment.supportPath, "subtitle-metadata.json"), { force: true });
}

describe("subtitle coordination composed workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    removeRevisionState();
    mockLaunchCommand.mockResolvedValue(undefined);
    mockUpdateCommandMetadata.mockResolvedValue(undefined);
    vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
    vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("anc");
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
    vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  });

  afterAll(() => {
    rmSync(environment.supportPath, { recursive: true, force: true });
  });

  it("clears the subtitle when the confirmed metadata write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockUpdateCommandMetadata.mockRejectedValueOnce(new Error("metadata failed"));

    await runSetListeningModeCommand("anc", { updateCycleSubtitle: true });

    expect(AirPodsControlCli.setListeningMode).toHaveBeenCalledWith("anc");
    expect(mockUpdateCommandMetadata.mock.calls.map(([metadata]) => metadata)).toEqual([
      { subtitle: "Noise Cancellation ◉" },
      { subtitle: null },
    ]);
  });

  it("refreshes all subtitles after a control action without retaining its operation lock", async () => {
    vi.mocked(AirPodsControlCli.setListeningMode).mockImplementationOnce(async () => {
      vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("adaptive");
      return "adaptive";
    });
    mockLaunchCommand.mockImplementation(async ({ name, context }) => {
      if (name === "refresh-airpods-status") {
        await refreshAirPodsStatus();
      } else if (name === CYCLE_LISTENING_MODE_COMMAND_NAME) {
        await cycleListeningMode({ launchType: LaunchType.Background, launchContext: context } as never);
      } else if (name === TOGGLE_CONVERSATION_AWARENESS_COMMAND_NAME) {
        await toggleConversationAwareness({ launchType: LaunchType.Background, launchContext: context } as never);
      }
    });

    await runSetListeningModeCommand("adaptive", { updateCycleSubtitle: true });

    expect(mockUpdateCommandMetadata).toHaveBeenCalledWith({ subtitle: "Adaptive ◑ · CA ○" });
    expect(mockUpdateCommandMetadata).toHaveBeenCalledWith({ subtitle: "Adaptive ◑" });
    expect(mockUpdateCommandMetadata).toHaveBeenCalledWith({ subtitle: "Off ○" });
    expect(mockLaunchCommand).toHaveBeenCalledTimes(3);
    expect(AirPodsControlCli.getListeningMode).toHaveBeenCalledOnce();
    expect(AirPodsControlCli.getConversationAwareness).toHaveBeenCalledOnce();
  });

  it("waits for a status read before allowing a control operation to reach the CLI", async () => {
    let resolveListeningRead!: (mode: ListeningModes) => void;
    const listeningRead = new Promise<ListeningModes>((resolve) => {
      resolveListeningRead = resolve;
    });
    vi.mocked(AirPodsControlCli.getListeningMode).mockReturnValue(listeningRead);

    const refreshPromise = refreshAirPodsStatus();
    await vi.waitFor(() => expect(AirPodsControlCli.getListeningMode).toHaveBeenCalledOnce());

    const controlPromise = runSetListeningModeCommand("anc", { updateCycleSubtitle: true });
    await Promise.resolve();
    expect(AirPodsControlCli.setListeningMode).not.toHaveBeenCalled();

    resolveListeningRead("transparency");
    await Promise.all([refreshPromise, controlPromise]);

    expect(AirPodsControlCli.setListeningMode).toHaveBeenCalledOnce();
    expect(vi.mocked(AirPodsControlCli.getListeningMode).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(AirPodsControlCli.setListeningMode).mock.invocationCallOrder[0],
    );
  });

  it("serializes status snapshots so a later refresh cannot publish before an older one finishes", async () => {
    let releaseFirstRead!: (mode: ListeningModes) => void;
    let readCount = 0;
    vi.mocked(AirPodsControlCli.getListeningMode).mockImplementation(() => {
      if (readCount++ === 0) {
        return new Promise<ListeningModes>((resolve) => {
          releaseFirstRead = resolve;
        });
      }
      return Promise.resolve("anc");
    });

    const firstRefresh = refreshAirPodsStatus();
    await vi.waitFor(() => expect(AirPodsControlCli.getListeningMode).toHaveBeenCalledOnce());

    const secondRefresh = refreshAirPodsStatus();
    await Promise.resolve();
    expect(AirPodsControlCli.getListeningMode).toHaveBeenCalledOnce();

    releaseFirstRead("transparency");
    await firstRefresh;
    await vi.waitFor(() => expect(AirPodsControlCli.getListeningMode).toHaveBeenCalledTimes(2));
    await secondRefresh;

    expect(mockUpdateCommandMetadata.mock.calls.map(([metadata]) => metadata.subtitle)).toEqual([
      "Transparency ◎ · CA ○",
      "Noise Cancellation ◉ · CA ○",
    ]);
  });

  it("serializes a standalone reset behind an in-flight control operation", async () => {
    let resolveSet!: (mode: ListeningModes) => void;
    const setResult = new Promise<ListeningModes>((resolve) => {
      resolveSet = resolve;
    });
    vi.mocked(AirPodsControlCli.setListeningMode).mockReturnValue(setResult);

    const controlPromise = runSetListeningModeCommand("anc", { updateCycleSubtitle: true });
    await vi.waitFor(() => expect(AirPodsControlCli.setListeningMode).toHaveBeenCalledOnce());

    const resetPromise = resetCommandSubtitle({ channel: "listening-mode" });
    await Promise.resolve();
    expect(mockUpdateCommandMetadata).not.toHaveBeenCalled();

    resolveSet("anc");
    await Promise.all([controlPromise, resetPromise]);

    expect(mockUpdateCommandMetadata.mock.calls.map(([metadata]) => metadata)).toEqual([
      { subtitle: "Noise Cancellation ◉" },
      { subtitle: null },
    ]);
  });

  it("ignores a delayed listening-mode dispatch after a newer confirmed set", async () => {
    const launches: LaunchCall[] = [];
    mockLaunchCommand.mockImplementation(async (options) => {
      launches.push(options);
    });

    await refreshAirPodsStatus();
    const listeningLaunch = launches.find(({ name }) => name === CYCLE_LISTENING_MODE_COMMAND_NAME);
    expect(listeningLaunch?.context).toEqual(
      expect.objectContaining({
        operation: "refresh-listening-mode-subtitle",
        mode: "transparency",
        revision: expect.any(String),
      }),
    );

    await runSetListeningModeCommand("anc", { updateCycleSubtitle: true });
    const metadataCallCountAfterSet = mockUpdateCommandMetadata.mock.calls.length;

    await cycleListeningMode({
      launchType: LaunchType.Background,
      arguments: undefined,
      launchContext: listeningLaunch?.context as unknown as ListeningModeSubtitleRefreshContext,
    } as never);

    expect(mockUpdateCommandMetadata.mock.calls.length).toBe(metadataCallCountAfterSet);
    expect(mockUpdateCommandMetadata).toHaveBeenLastCalledWith({ subtitle: "Noise Cancellation ◉" });
  });

  it("ignores a delayed Conversation Awareness dispatch after a newer confirmed toggle", async () => {
    const launches: LaunchCall[] = [];
    mockLaunchCommand.mockImplementation(async (options) => {
      launches.push(options);
    });

    await refreshAirPodsStatus();
    const conversationLaunch = launches.find(({ name }) => name === TOGGLE_CONVERSATION_AWARENESS_COMMAND_NAME);
    expect(conversationLaunch?.context).toEqual(
      expect.objectContaining({
        operation: "refresh-conversation-awareness-subtitle",
        state: "off",
        revision: expect.any(String),
      }),
    );

    await runToggleConversationAwarenessCommand();
    const metadataCallCountAfterToggle = mockUpdateCommandMetadata.mock.calls.length;

    await toggleConversationAwareness({
      launchType: LaunchType.Background,
      arguments: undefined,
      launchContext: conversationLaunch?.context,
    } as never);

    expect(mockUpdateCommandMetadata.mock.calls.length).toBe(metadataCallCountAfterToggle);
    expect(mockUpdateCommandMetadata).toHaveBeenLastCalledWith({ subtitle: "On ●" });
  });

  it("re-reads legacy null refresh contexts instead of clearing a current subtitle", async () => {
    vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");

    await cycleListeningMode({
      launchType: LaunchType.Background,
      arguments: undefined,
      launchContext: { operation: "refresh-listening-mode-subtitle", mode: null },
    } as never);

    expect(AirPodsControlCli.getListeningMode).toHaveBeenCalledOnce();
    expect(mockUpdateCommandMetadata).toHaveBeenCalledWith({ subtitle: "Noise Cancellation ◉" });
    expect(mockUpdateCommandMetadata).not.toHaveBeenCalledWith({ subtitle: null });
  });

  it("re-reads legacy Conversation Awareness null contexts instead of clearing a current subtitle", async () => {
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");

    await toggleConversationAwareness({
      launchType: LaunchType.Background,
      arguments: undefined,
      launchContext: { operation: "refresh-conversation-awareness-subtitle", state: null },
    } as never);

    expect(AirPodsControlCli.getConversationAwareness).toHaveBeenCalledOnce();
    expect(mockUpdateCommandMetadata).toHaveBeenCalledWith({ subtitle: "On ●" });
    expect(mockUpdateCommandMetadata).not.toHaveBeenCalledWith({ subtitle: null });
  });

  it.each(["missing", "malformed"] as const)("does not accept an old token after %s state recovery", (kind) => {
    mkdirSync(environment.supportPath, { recursive: true });
    const statePath = join(environment.supportPath, "subtitle-metadata.json");
    if (kind === "missing") {
      rmSync(statePath, { force: true });
    } else {
      writeFileSync(statePath, "{broken", "utf8");
    }

    return (async () => {
      await publishCommandSubtitle("Stale", { channel: "listening-mode", revision: "old-token" });
      expect(mockUpdateCommandMetadata).not.toHaveBeenCalled();

      const freshRevision = await reserveSubtitleRevisionForReset("listening-mode");
      expect(freshRevision).not.toBe("old-token");
      await publishCommandSubtitle("Fresh", { channel: "listening-mode", revision: freshRevision });
      expect(mockUpdateCommandMetadata).toHaveBeenCalledWith({ subtitle: "Fresh" });
    })();
  });

  it.skipIf(process.platform !== "darwin")(
    "holds the production operation lock across an awaited control call",
    async () => {
      let resolveSet!: (mode: ListeningModes) => void;
      const setResult = new Promise<ListeningModes>((resolve) => {
        resolveSet = resolve;
      });
      vi.mocked(AirPodsControlCli.setListeningMode).mockReturnValue(setResult);

      const controlPromise = runSetListeningModeCommand("anc", { updateCycleSubtitle: true });
      const lockPath = join(environment.supportPath, "subtitle-listening-mode-operation.lock");
      try {
        await vi.waitFor(() => expect(AirPodsControlCli.setListeningMode).toHaveBeenCalledOnce());
        await expect(runLockf(lockPath, "0")).resolves.toBe(75);
      } finally {
        resolveSet("anc");
        await controlPromise;
      }

      await expect(runLockf(lockPath, "0")).resolves.toBe(0);
    },
  );
});
