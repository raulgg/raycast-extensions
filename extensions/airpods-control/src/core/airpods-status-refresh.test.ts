import { launchCommand, LaunchType, showToast, Toast } from "@raycast/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as AirPodsControlCli from "./airpods-control-cli";
import {
  conversationAwarenessFromSubtitleRefreshContext,
  listeningModeFromSubtitleRefreshContext,
  refreshAirPodsStatus,
  resetAirPodsStatusSubtitles,
  runAirPodsStatusRefresh,
} from "./airpods-status-refresh";
import { CliError } from "./cli";
import { CYCLE_LISTENING_MODE_COMMAND_NAME, TOGGLE_CONVERSATION_AWARENESS_COMMAND_NAME } from "./consts";

vi.mock("./airpods-control-cli", () => ({
  getConversationAwareness: vi.fn(),
  getListeningMode: vi.fn(),
}));

const mockLaunchCommand = vi.mocked(launchCommand);
const mockShowToast = vi.mocked(showToast);

function makeToast(): Toast {
  return {
    style: Toast.Style.Animated,
    title: "Refreshing AirPods status...",
    message: undefined,
    primaryAction: undefined,
    secondaryAction: undefined,
    hide: vi.fn(async () => {}),
    show: vi.fn(async () => {}),
    id: "status-refresh",
    options: {},
    callbacks: {},
  } as unknown as Toast;
}

describe("AirPods status refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads each status once and dispatches validated subtitle-only contexts", async () => {
    const result = await refreshAirPodsStatus();

    expect(result).toEqual({
      listeningMode: { status: "fulfilled", value: "anc" },
      conversationAwareness: { status: "fulfilled", value: "on" },
      subtitleDispatch: {
        listeningMode: { status: "fulfilled", value: undefined },
        conversationAwareness: { status: "fulfilled", value: undefined },
      },
    });
    expect(AirPodsControlCli.getListeningMode).toHaveBeenCalledOnce();
    expect(AirPodsControlCli.getConversationAwareness).toHaveBeenCalledOnce();
    expect(mockLaunchCommand).toHaveBeenCalledWith({
      name: CYCLE_LISTENING_MODE_COMMAND_NAME,
      type: LaunchType.Background,
      context: {
        operation: "refresh-listening-mode-subtitle",
        mode: "anc",
        revision: expect.any(String),
      },
    });
    expect(mockLaunchCommand).toHaveBeenCalledWith({
      name: TOGGLE_CONVERSATION_AWARENESS_COMMAND_NAME,
      type: LaunchType.Background,
      context: {
        operation: "refresh-conversation-awareness-subtitle",
        state: "on",
        revision: expect.any(String),
      },
    });
  });

  it("preserves a rejected Cycle Listening Mode launch separately from successful reads", async () => {
    const error = new Error("Cycle Listening Mode is disabled");
    mockLaunchCommand.mockRejectedValueOnce(error);

    const result = await refreshAirPodsStatus();

    expect(result.listeningMode).toEqual({ status: "fulfilled", value: "anc" });
    expect(result.conversationAwareness).toEqual({ status: "fulfilled", value: "on" });
    expect(result.subtitleDispatch.listeningMode).toEqual({ status: "rejected", reason: error });
    expect(result.subtitleDispatch.conversationAwareness).toEqual({ status: "fulfilled", value: undefined });
  });

  it("preserves a rejected Conversation Awareness launch separately from successful reads", async () => {
    const error = new Error("Conversation Awareness is disabled");
    mockLaunchCommand.mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);

    const result = await refreshAirPodsStatus();

    expect(result.listeningMode).toEqual({ status: "fulfilled", value: "anc" });
    expect(result.conversationAwareness).toEqual({ status: "fulfilled", value: "on" });
    expect(result.subtitleDispatch.listeningMode).toEqual({ status: "fulfilled", value: undefined });
    expect(result.subtitleDispatch.conversationAwareness).toEqual({ status: "rejected", reason: error });
  });

  it("preserves both rejected subtitle launches", async () => {
    const listeningError = new Error("Cycle Listening Mode is disabled");
    const conversationError = new Error("Conversation Awareness is disabled");
    mockLaunchCommand.mockRejectedValueOnce(listeningError).mockRejectedValueOnce(conversationError);

    const result = await refreshAirPodsStatus();

    expect(result.subtitleDispatch).toEqual({
      listeningMode: { status: "rejected", reason: listeningError },
      conversationAwareness: { status: "rejected", reason: conversationError },
    });
  });

  it("resets only a status that could not be read", async () => {
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(new CliError("unsupported"));

    await refreshAirPodsStatus();

    expect(mockLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ operation: "refresh-listening-mode-subtitle", mode: "anc" }),
      }),
    );
    expect(mockLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ operation: "refresh-conversation-awareness-subtitle", state: null }),
      }),
    );
  });

  it("dispatches neutral subtitles without querying the CLI during setup fallback", async () => {
    await resetAirPodsStatusSubtitles();

    expect(AirPodsControlCli.getListeningMode).not.toHaveBeenCalled();
    expect(AirPodsControlCli.getConversationAwareness).not.toHaveBeenCalled();
    expect(mockLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ operation: "refresh-listening-mode-subtitle", mode: null }),
      }),
    );
    expect(mockLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ operation: "refresh-conversation-awareness-subtitle", state: null }),
      }),
    );
  });

  it("logs rejected subtitle launches during setup fallback", async () => {
    const error = new Error("Cycle Listening Mode is disabled");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockLaunchCommand.mockRejectedValueOnce(error);

    await resetAirPodsStatusSubtitles();

    expect(consoleError).toHaveBeenCalledWith("Failed to dispatch Cycle Listening Mode subtitle refresh", error);
  });

  it("stays silent on a scheduled refresh", async () => {
    await runAirPodsStatusRefresh({ showFeedback: false });

    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockLaunchCommand).toHaveBeenCalledTimes(2);
  });

  it("logs each rejected subtitle launch while staying silent in the background", async () => {
    const listeningError = new Error("Cycle Listening Mode is disabled");
    const conversationError = new Error("Conversation Awareness is disabled");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockLaunchCommand.mockRejectedValueOnce(listeningError).mockRejectedValueOnce(conversationError);

    await runAirPodsStatusRefresh({ showFeedback: false });

    expect(mockShowToast).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenNthCalledWith(
      1,
      "Failed to dispatch Cycle Listening Mode subtitle refresh",
      listeningError,
    );
    expect(consoleError).toHaveBeenNthCalledWith(
      2,
      "Failed to dispatch Toggle Conversation Awareness subtitle refresh",
      conversationError,
    );
  });

  it("keeps Raycast open and reports both confirmed states in a success toast", async () => {
    const toast = makeToast();
    mockShowToast.mockResolvedValueOnce(toast);

    await runAirPodsStatusRefresh({ showFeedback: true });

    expect(mockShowToast).toHaveBeenCalledWith({
      style: Toast.Style.Animated,
      title: "Refreshing AirPods status...",
    });
    expect(toast.style).toBe(Toast.Style.Success);
    expect(toast.title).toBe("AirPods status read");
    expect(toast.message).toBe("Listening: Noise Cancellation ● · Conversation Awareness: On ●");
    expect(toast.primaryAction).toBeUndefined();
    expect(toast.show).toHaveBeenCalledOnce();
  });

  it("reports a subtitle launch failure while retaining both confirmed states", async () => {
    const toast = makeToast();
    const error = new Error("Cycle Listening Mode is disabled");
    mockShowToast.mockResolvedValueOnce(toast);
    mockLaunchCommand.mockRejectedValueOnce(error);

    await runAirPodsStatusRefresh({ showFeedback: true });

    expect(toast.style).toBe(Toast.Style.Failure);
    expect(toast.title).toBe("Could not refresh subtitles");
    expect(toast.message).toBe(
      "Listening: Noise Cancellation ● · Conversation Awareness: On ● · Listening Mode subtitle: Cycle Listening Mode is disabled",
    );
    expect(toast.primaryAction).toEqual(expect.objectContaining({ title: "Copy Error" }));
    expect(toast.show).toHaveBeenCalledOnce();
  });

  it("includes read and subtitle launch failures in manual feedback", async () => {
    const toast = makeToast();
    const readError = new CliError("unsupported");
    const launchError = new Error("Cycle Listening Mode is disabled");
    mockShowToast.mockResolvedValueOnce(toast);
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(readError);
    mockLaunchCommand.mockRejectedValueOnce(launchError);

    await runAirPodsStatusRefresh({ showFeedback: true });

    expect(toast.style).toBe(Toast.Style.Failure);
    expect(toast.title).toBe("AirPods status partially refreshed");
    expect(toast.message).toContain("Listening: Noise Cancellation ●");
    expect(toast.message).toContain("Conversation Awareness: This feature is not supported");
    expect(toast.message).toContain("Listening Mode subtitle: Cycle Listening Mode is disabled");
    expect(toast.primaryAction).toEqual(expect.objectContaining({ title: "Copy Error" }));
    expect(toast.show).toHaveBeenCalledOnce();
  });

  it("reports a partial refresh while preserving the confirmed status", async () => {
    const toast = makeToast();
    mockShowToast.mockResolvedValueOnce(toast);
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(new CliError("unsupported"));

    await runAirPodsStatusRefresh({ showFeedback: true });

    expect(toast.style).toBe(Toast.Style.Failure);
    expect(toast.title).toBe("AirPods status partially refreshed");
    expect(toast.message).toContain("Listening: Noise Cancellation ●");
    expect(toast.message).toContain("Conversation Awareness: This feature is not supported");
    expect(toast.primaryAction).toEqual(expect.objectContaining({ title: "Copy Error" }));
    expect(toast.show).toHaveBeenCalledOnce();
  });

  it("deduplicates a shared failure when neither status can be read", async () => {
    const toast = makeToast();
    mockShowToast.mockResolvedValueOnce(toast);
    vi.mocked(AirPodsControlCli.getListeningMode).mockRejectedValue(new CliError("no-device"));
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(new CliError("no-device"));

    await runAirPodsStatusRefresh({ showFeedback: true });

    expect(toast.style).toBe(Toast.Style.Failure);
    expect(toast.title).toBe("Failed to refresh AirPods status");
    expect(toast.message).toBe("Connect your AirPods to your Mac and try again.");
    expect(toast.show).toHaveBeenCalledOnce();
  });

  it.each([
    [{ operation: "refresh-listening-mode-subtitle", mode: "adaptive" }, "adaptive"],
    [{ operation: "refresh-listening-mode-subtitle", mode: null }, null],
  ] as const)("parses listening mode refresh context %#", (context, expected) => {
    expect(listeningModeFromSubtitleRefreshContext(context)).toBe(expected);
  });

  it.each([
    [{ operation: "refresh-conversation-awareness-subtitle", state: "off" }, "off"],
    [{ operation: "refresh-conversation-awareness-subtitle", state: null }, null],
  ] as const)("parses Conversation Awareness refresh context %#", (context, expected) => {
    expect(conversationAwarenessFromSubtitleRefreshContext(context)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    {},
    { operation: "set", mode: "anc" },
    { operation: "refresh-listening-mode-subtitle", mode: "future" },
  ])("rejects invalid listening mode refresh context %#", (context) => {
    expect(listeningModeFromSubtitleRefreshContext(context)).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    {},
    { operation: "toggle", state: "on" },
    { operation: "refresh-conversation-awareness-subtitle", state: "future" },
  ])("rejects invalid Conversation Awareness refresh context %#", (context) => {
    expect(conversationAwarenessFromSubtitleRefreshContext(context)).toBeUndefined();
  });
});
