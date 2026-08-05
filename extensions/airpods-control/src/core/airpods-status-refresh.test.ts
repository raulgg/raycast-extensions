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
    });
    expect(AirPodsControlCli.getListeningMode).toHaveBeenCalledOnce();
    expect(AirPodsControlCli.getConversationAwareness).toHaveBeenCalledOnce();
    expect(mockLaunchCommand).toHaveBeenCalledWith({
      name: CYCLE_LISTENING_MODE_COMMAND_NAME,
      type: LaunchType.Background,
      context: { operation: "refresh-listening-mode-subtitle", mode: "anc" },
    });
    expect(mockLaunchCommand).toHaveBeenCalledWith({
      name: TOGGLE_CONVERSATION_AWARENESS_COMMAND_NAME,
      type: LaunchType.Background,
      context: { operation: "refresh-conversation-awareness-subtitle", state: "on" },
    });
  });

  it("resets only a status that could not be read", async () => {
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(new CliError("unsupported"));

    await refreshAirPodsStatus();

    expect(mockLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({ context: { operation: "refresh-listening-mode-subtitle", mode: "anc" } }),
    );
    expect(mockLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({ context: { operation: "refresh-conversation-awareness-subtitle", state: null } }),
    );
  });

  it("dispatches neutral subtitles without querying the CLI during setup fallback", async () => {
    await resetAirPodsStatusSubtitles();

    expect(AirPodsControlCli.getListeningMode).not.toHaveBeenCalled();
    expect(AirPodsControlCli.getConversationAwareness).not.toHaveBeenCalled();
    expect(mockLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({ context: { operation: "refresh-listening-mode-subtitle", mode: null } }),
    );
    expect(mockLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({ context: { operation: "refresh-conversation-awareness-subtitle", state: null } }),
    );
  });

  it("stays silent on a scheduled refresh", async () => {
    await runAirPodsStatusRefresh({ showFeedback: false });

    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockLaunchCommand).toHaveBeenCalledTimes(2);
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
    expect(toast.title).toBe("AirPods status refreshed");
    expect(toast.message).toBe("Listening: Noise Cancellation ● · Conversation Awareness: On ●");
    expect(toast.primaryAction).toBeUndefined();
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
