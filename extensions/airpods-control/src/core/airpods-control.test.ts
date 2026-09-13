import { getPreferenceValues, launchCommand, LaunchType, openCommandPreferences } from "@raycast/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  refreshConversationAwarenessSubtitle,
  refreshListeningModeSubtitle,
  runCycleListeningModeCommand,
  runSetListeningModeCommand,
  runToggleConversationAwarenessCommand,
} from "./airpods-control";
import * as AirPodsControlCli from "./airpods-control-cli";
import { CliError } from "./cli";
import { publishCommandSubtitle, resetCommandSubtitle, withSubtitleOperation } from "./command-metadata";
import { ToastManager } from "./toast-manager";
import type { CycleCommandPreferences } from "./types";

vi.mock("./airpods-control-cli", () => ({
  confirmedConversationAwareness: vi.fn((payload) => payload?.conversationAwareness ?? null),
  confirmedListeningMode: vi.fn((payload) => {
    const modes: Record<string, string> = {
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

vi.mock("./command-metadata", () => ({
  publishCommandSubtitle: vi.fn(),
  resetCommandSubtitle: vi.fn(),
  withSubtitleOperation: vi.fn(async (_channel, operation) => operation("test-revision")),
}));

vi.mock("./toast-manager", () => ({
  ToastManager: vi.fn(),
}));

const mockGetPreferenceValues = vi.mocked(getPreferenceValues);
const mockOpenCommandPreferences = vi.mocked(openCommandPreferences);
const mockPublishCommandSubtitle = vi.mocked(publishCommandSubtitle);
const mockResetCommandSubtitle = vi.mocked(resetCommandSubtitle);
const mockToastManager = vi.mocked(ToastManager);

const defaultCyclePreferences: CycleCommandPreferences = {
  cycleOff: false,
  cycleTransparency: true,
  cycleAdaptive: true,
  cycleAnc: true,
};

describe("airpods-control workflows", () => {
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockToastManager.mockImplementation(function (this: unknown) {
      Object.assign(this as object, toast);
      return this as ToastManager;
    });
    mockGetPreferenceValues.mockReturnValue(defaultCyclePreferences as never);
    vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
    vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
    vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
    vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["set", () => runSetListeningModeCommand("adaptive", { updateCycleSubtitle: true })],
    ["fallback set", () => runSetListeningModeCommand("adaptive", { updateCycleSubtitle: false })],
    ["cycle", runCycleListeningModeCommand],
    ["toggle", runToggleConversationAwarenessCommand],
  ] as const)("requests status synchronization after %s releases its lock", async (_name, run) => {
    let locked = false;
    vi.mocked(withSubtitleOperation).mockImplementationOnce(async (_channel, operation) => {
      locked = true;
      try {
        return await operation("test-revision");
      } finally {
        locked = false;
      }
    });
    vi.mocked(launchCommand).mockImplementationOnce(async () => {
      expect(locked).toBe(false);
      expect(toast.setToSuccess).toHaveBeenCalledOnce();
    });

    await run();

    expect(launchCommand).toHaveBeenCalledExactlyOnceWith({
      name: "refresh-airpods-status",
      type: LaunchType.Background,
    });
  });

  it("requests reconciliation after a failed control attempt", async () => {
    vi.mocked(AirPodsControlCli.setListeningMode).mockRejectedValueOnce(new CliError("no-device"));
    await runSetListeningModeCommand("adaptive", { updateCycleSubtitle: true });
    expect(toast.setToFailure).toHaveBeenCalledOnce();
    expect(launchCommand).toHaveBeenCalledOnce();
  });

  it("preserves control success when the status command is disabled", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(launchCommand).mockRejectedValueOnce(new Error("command disabled"));
    await expect(runSetListeningModeCommand("adaptive", { updateCycleSubtitle: true })).resolves.toBeUndefined();
    expect(toast.setToSuccess).toHaveBeenCalledOnce();
    expect(toast.setToFailure).not.toHaveBeenCalled();
  });

  it("does not launch a refresh when the control lock cannot be acquired", async () => {
    vi.mocked(withSubtitleOperation).mockRejectedValueOnce(new Error("lock unavailable"));
    await runSetListeningModeCommand("adaptive", { updateCycleSubtitle: true });
    expect(AirPodsControlCli.setListeningMode).not.toHaveBeenCalled();
    expect(launchCommand).not.toHaveBeenCalled();
  });

  it("does not launch another refresh from subtitle-only background reads", async () => {
    await refreshListeningModeSubtitle();
    await refreshConversationAwarenessSubtitle();
    expect(launchCommand).not.toHaveBeenCalled();
  });

  describe("background subtitle refresh", () => {
    it("publishes the current listening mode without changing it or showing feedback", async () => {
      vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");

      await refreshListeningModeSubtitle();

      expect(AirPodsControlCli.getListeningMode).toHaveBeenCalledOnce();
      expect(mockPublishCommandSubtitle).toHaveBeenCalledWith("Noise Cancellation ◉", {
        channel: "listening-mode",
        revision: "test-revision",
      });
      expect(AirPodsControlCli.cycleListeningMode).not.toHaveBeenCalled();
      expect(AirPodsControlCli.setListeningMode).not.toHaveBeenCalled();
      expect(mockToastManager).not.toHaveBeenCalled();
    });

    it("restores AirPods when the listening mode cannot be read", async () => {
      vi.mocked(AirPodsControlCli.getListeningMode).mockRejectedValue(new CliError("no-device"));

      await expect(refreshListeningModeSubtitle()).resolves.toBeUndefined();

      expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
      expect(mockResetCommandSubtitle).toHaveBeenCalledOnce();
      expect(mockToastManager).not.toHaveBeenCalled();
    });

    it("publishes the current Conversation Awareness state without changing it or showing feedback", async () => {
      vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");

      await refreshConversationAwarenessSubtitle();

      expect(AirPodsControlCli.getConversationAwareness).toHaveBeenCalledOnce();
      expect(mockPublishCommandSubtitle).toHaveBeenCalledWith("Off ○", {
        channel: "conversation-awareness",
        revision: "test-revision",
      });
      expect(AirPodsControlCli.setConversationAwareness).not.toHaveBeenCalled();
      expect(mockToastManager).not.toHaveBeenCalled();
    });

    it("restores AirPods when Conversation Awareness cannot be read", async () => {
      vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(new CliError("unsupported"));

      await expect(refreshConversationAwarenessSubtitle()).resolves.toBeUndefined();

      expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
      expect(mockResetCommandSubtitle).toHaveBeenCalledOnce();
      expect(mockToastManager).not.toHaveBeenCalled();
    });
  });

  describe("runSetListeningModeCommand", () => {
    it("publishes the confirmed mode after setting it", async () => {
      vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("anc");

      await runSetListeningModeCommand("anc", { updateCycleSubtitle: true });

      expect(AirPodsControlCli.setListeningMode).toHaveBeenCalledWith("anc");
      expect(mockPublishCommandSubtitle).toHaveBeenCalledExactlyOnceWith("Noise Cancellation ◉", {
        channel: "listening-mode",
        revision: "test-revision",
      });
      expect(vi.mocked(AirPodsControlCli.setListeningMode).mock.invocationCallOrder[0]).toBeLessThan(
        mockPublishCommandSubtitle.mock.invocationCallOrder[0],
      );
      expect(toast.setToSuccess).toHaveBeenCalledWith({ titleOverride: "Set to Noise Cancellation ◉" });
    });

    it("does not update the fixed command subtitle in the disabled-Cycle fallback", async () => {
      await runSetListeningModeCommand("transparency", { updateCycleSubtitle: false });

      expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
      expect(toast.setToSuccess).toHaveBeenCalledWith({ titleOverride: "Set to Transparency ◎" });
    });

    it("publishes a confirmed remaining state from a failed change", async () => {
      const error = new CliError("no-op", {
        result: "error",
        device: "My AirPods Pro",
        listeningMode: "transparency",
      });
      vi.mocked(AirPodsControlCli.setListeningMode).mockRejectedValue(error);

      await runSetListeningModeCommand("anc", { updateCycleSubtitle: true });

      expect(mockPublishCommandSubtitle).toHaveBeenCalledExactlyOnceWith("Transparency ◎", {
        channel: "listening-mode",
        revision: "test-revision",
      });
      expect(toast.setToFailure).toHaveBeenCalledWith({ error });
      expect(toast.setToSuccess).not.toHaveBeenCalled();
    });

    it("keeps the Off-specific failure guidance", async () => {
      vi.mocked(AirPodsControlCli.setListeningMode).mockRejectedValue(new CliError("no-op"));

      await runSetListeningModeCommand("off", { updateCycleSubtitle: true });

      expect(toast.setToFailure).toHaveBeenCalledWith({
        titleOverride: "Off mode was not applied",
        error: expect.objectContaining({ message: expect.stringContaining("Off may be disabled") }),
      });
      expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
      expect(mockResetCommandSubtitle).toHaveBeenCalledOnce();
    });

    it("restores AirPods after an unexpected failure", async () => {
      vi.mocked(AirPodsControlCli.setListeningMode).mockRejectedValue(new Error("unexpected"));

      await runSetListeningModeCommand("adaptive", { updateCycleSubtitle: true });

      expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
      expect(mockResetCommandSubtitle).toHaveBeenCalledOnce();
    });
  });

  describe("runCycleListeningModeCommand", () => {
    it("publishes the confirmed mode after cycling", async () => {
      vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("adaptive");

      await runCycleListeningModeCommand();

      expect(AirPodsControlCli.getListeningMode).not.toHaveBeenCalled();
      expect(AirPodsControlCli.cycleListeningMode).toHaveBeenCalledWith(["transparency", "adaptive", "anc"]);
      expect(mockPublishCommandSubtitle).toHaveBeenCalledExactlyOnceWith("Adaptive ◑", {
        channel: "listening-mode",
        revision: "test-revision",
      });
      expect(vi.mocked(AirPodsControlCli.cycleListeningMode).mock.invocationCallOrder[0]).toBeLessThan(
        mockPublishCommandSubtitle.mock.invocationCallOrder[0],
      );
      expect(toast.setToSuccess).toHaveBeenCalledWith({
        titleOverride: "Set to Adaptive ◑",
      });
    });

    it.each([
      ["zero", { cycleOff: false, cycleTransparency: false, cycleAdaptive: false, cycleAnc: false }],
      ["one", { cycleOff: false, cycleTransparency: true, cycleAdaptive: false, cycleAnc: false }],
    ] as const)("rejects %s selected cycle modes before reading or writing", async (_count, preferences) => {
      mockGetPreferenceValues.mockReturnValue(preferences as never);

      await runCycleListeningModeCommand();

      expect(AirPodsControlCli.getListeningMode).not.toHaveBeenCalled();
      expect(AirPodsControlCli.cycleListeningMode).not.toHaveBeenCalled();
      expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
      expect(mockResetCommandSubtitle).not.toHaveBeenCalled();
      expect(toast.setToFailure).toHaveBeenCalledWith({
        error: expect.objectContaining({ message: expect.stringContaining("at least two") }),
        action: {
          title: "Open Command Preferences",
          onAction: mockOpenCommandPreferences,
        },
      });
      expect(toast.setToSuccess).not.toHaveBeenCalled();
    });

    it("passes the selected modes to the CLI in canonical order", async () => {
      mockGetPreferenceValues.mockReturnValue({
        cycleOff: false,
        cycleTransparency: true,
        cycleAdaptive: false,
        cycleAnc: true,
      } as never);
      vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("anc");

      await runCycleListeningModeCommand();

      expect(AirPodsControlCli.cycleListeningMode).toHaveBeenCalledWith(["transparency", "anc"]);
      expect(mockPublishCommandSubtitle).toHaveBeenCalledExactlyOnceWith("Noise Cancellation ◉", {
        channel: "listening-mode",
        revision: "test-revision",
      });
    });

    it("publishes confirmed state while preserving selected-mode failure guidance", async () => {
      const error = new CliError("unsupported", {
        result: "error",
        device: "My AirPods Pro",
        listeningMode: "noise-cancellation",
      });
      vi.mocked(AirPodsControlCli.cycleListeningMode).mockRejectedValue(error);

      await runCycleListeningModeCommand();

      expect(mockPublishCommandSubtitle).toHaveBeenCalledExactlyOnceWith("Noise Cancellation ◉", {
        channel: "listening-mode",
        revision: "test-revision",
      });
      expect(toast.setToFailure).toHaveBeenCalledWith({
        error: expect.objectContaining({ message: expect.stringContaining("fewer than two") }),
        action: {
          title: "Open Command Preferences",
          onAction: mockOpenCommandPreferences,
        },
      });
    });

    it("restores AirPods when cycling fails without a confirmed mode", async () => {
      vi.mocked(AirPodsControlCli.cycleListeningMode).mockRejectedValue(new CliError("no-op"));

      await runCycleListeningModeCommand();

      expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
      expect(mockResetCommandSubtitle).toHaveBeenCalledOnce();
    });
  });

  describe("runToggleConversationAwarenessCommand", () => {
    it("publishes the confirmed state after toggling", async () => {
      await runToggleConversationAwarenessCommand();

      expect(AirPodsControlCli.setConversationAwareness).toHaveBeenCalledWith("on");
      expect(mockPublishCommandSubtitle).toHaveBeenCalledExactlyOnceWith("On ●", {
        channel: "conversation-awareness",
        revision: "test-revision",
      });
      expect(vi.mocked(AirPodsControlCli.setConversationAwareness).mock.invocationCallOrder[0]).toBeLessThan(
        mockPublishCommandSubtitle.mock.invocationCallOrder[0],
      );
      expect(toast.setToSuccess).toHaveBeenCalledWith({ titleOverride: "Conversation Awareness On ●" });
    });

    it("publishes the confirmed state from a failed toggle", async () => {
      const error = new CliError("no-op", {
        result: "error",
        device: "My AirPods Pro",
        conversationAwareness: "off",
      });
      vi.mocked(AirPodsControlCli.setConversationAwareness).mockRejectedValue(error);

      await runToggleConversationAwarenessCommand();

      expect(mockPublishCommandSubtitle).toHaveBeenCalledExactlyOnceWith("Off ○", {
        channel: "conversation-awareness",
        revision: "test-revision",
      });
      expect(toast.setToFailure).toHaveBeenCalledWith({ error });
    });

    it("preserves unsupported-device feedback", async () => {
      vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(new CliError("unsupported"));

      await runToggleConversationAwarenessCommand();

      expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
      expect(mockResetCommandSubtitle).toHaveBeenCalledOnce();
      expect(toast.setToFailure).toHaveBeenCalledWith({
        titleOverride: "Conversation Awareness not supported",
        error: expect.objectContaining({ message: expect.stringContaining("doesn't support") }),
      });
    });

    it("restores AirPods when a toggle fails without a confirmed state", async () => {
      vi.mocked(AirPodsControlCli.setConversationAwareness).mockRejectedValue(new CliError("no-op"));

      await runToggleConversationAwarenessCommand();

      expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
      expect(mockResetCommandSubtitle).toHaveBeenCalledOnce();
    });
  });
});
