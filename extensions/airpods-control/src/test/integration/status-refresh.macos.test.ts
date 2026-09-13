import { Clipboard, launchCommand, LaunchType, showToast, Toast, updateCommandMetadata } from "@raycast/api";
import { expect, vi, test } from "vitest";
import * as AirPodsControlCli from "../../cli/client";
import { CliError } from "../../cli/errors";
import { CYCLE_LISTENING_MODE_COMMAND_NAME, TOGGLE_CONVERSATION_AWARENESS_COMMAND_NAME } from "../../commands/names";
import { refreshAirPodsStatus, resetAirPodsStatusSubtitles, runAirPodsStatusRefresh } from "../../status/refresh";
import { createSupportDirectory } from "../fixtures/support-directory";

vi.mock("../../cli/client", () => ({
  getConversationAwareness: vi.fn(),
  getListeningMode: vi.fn(),
}));

const mockLaunchCommand = vi.mocked(launchCommand);

const mockShowToast = vi.mocked(showToast);

const mockUpdateCommandMetadata = vi.mocked(updateCommandMetadata);

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

// These workflows use macOS lockf and must retain real OS locking.

test.skipIf(process.platform !== "darwin")(
  "reads each status once and dispatches validated subtitle-only contexts",
  async () => {
    // Given
    createSupportDirectory();
    vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
    // When
    const result = await refreshAirPodsStatus();
    // Then
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
    expect(mockUpdateCommandMetadata).toHaveBeenCalledWith({
      subtitle: "Noise Cancellation ◉ · CA ●",
    });
    const listeningRevision = mockLaunchCommand.mock.calls.find(
      ([options]) => options.name === CYCLE_LISTENING_MODE_COMMAND_NAME,
    )?.[0].context?.revision;
    const conversationRevision = mockLaunchCommand.mock.calls.find(
      ([options]) => options.name === TOGGLE_CONVERSATION_AWARENESS_COMMAND_NAME,
    )?.[0].context?.revision;
    expect(listeningRevision).toBe(conversationRevision);
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
  },
);

test.skipIf(process.platform !== "darwin").each([
  { name: "listening mode", listeningFails: true, conversationFails: false },
  { name: "Conversation Awareness", listeningFails: false, conversationFails: true },
  { name: "both features", listeningFails: true, conversationFails: true },
])("retains successful reads when subtitle dispatch fails for $name", async ({ listeningFails, conversationFails }) => {
  // Given
  createSupportDirectory();
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
  const listeningError = new Error("Cycle Listening Mode is disabled");
  const conversationError = new Error("Conversation Awareness is disabled");
  mockLaunchCommand.mockImplementation(async ({ name }) => {
    if (name === "cycle-listening-mode" && listeningFails) throw listeningError;
    if (name === "toggle-conversation-awareness" && conversationFails) throw conversationError;
  });
  // When
  const result = await refreshAirPodsStatus();
  // Then
  expect(result.listeningMode).toEqual({ status: "fulfilled", value: "anc" });
  expect(result.conversationAwareness).toEqual({ status: "fulfilled", value: "on" });
  expect(result.subtitleDispatch).toEqual({
    listeningMode: listeningFails
      ? { status: "rejected", reason: listeningError }
      : { status: "fulfilled", value: undefined },
    conversationAwareness: conversationFails
      ? { status: "rejected", reason: conversationError }
      : { status: "fulfilled", value: undefined },
  });
});

test.skipIf(process.platform !== "darwin")(
  "publishes the confirmed partial status and resets only the unread feature",
  async () => {
    // Given
    createSupportDirectory();
    vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(new CliError("unsupported"));
    // When
    await refreshAirPodsStatus();
    // Then
    expect(mockUpdateCommandMetadata).toHaveBeenCalledWith({ subtitle: "Noise Cancellation ◉" });
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
  },
);

test.skipIf(process.platform !== "darwin").each([
  ["no-device", "Not connected"],
  ["unavailable", null],
] as const)("publishes the appropriate subtitle for %s", async (code, subtitle) => {
  // Given
  createSupportDirectory();
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
  // When
  const error = new CliError(code);
  vi.mocked(AirPodsControlCli.getListeningMode).mockRejectedValue(error);
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(error);
  await refreshAirPodsStatus();
  // Then
  expect(mockUpdateCommandMetadata).toHaveBeenCalledWith({ subtitle });
});

test.skipIf(process.platform !== "darwin")("updates the subtitle when AirPods disconnect and reconnect", async () => {
  // Given
  createSupportDirectory();
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
  vi.mocked(AirPodsControlCli.getListeningMode)
    .mockResolvedValueOnce("anc")
    .mockRejectedValueOnce(new CliError("no-device"))
    .mockResolvedValueOnce("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness)
    .mockResolvedValueOnce("on")
    .mockRejectedValueOnce(new CliError("no-device"))
    .mockResolvedValueOnce("off");
  // When
  await refreshAirPodsStatus();
  // Then
  expect(mockUpdateCommandMetadata).toHaveBeenLastCalledWith({ subtitle: "Noise Cancellation ◉ · CA ●" });
  // When
  await refreshAirPodsStatus();
  // Then
  expect(mockUpdateCommandMetadata).toHaveBeenLastCalledWith({ subtitle: "Not connected" });
  // When
  await refreshAirPodsStatus();
  // Then
  expect(mockUpdateCommandMetadata.mock.calls).toEqual([
    [{ subtitle: "Noise Cancellation ◉ · CA ●" }],
    [{ subtitle: "Not connected" }],
    [{ subtitle: "Transparency ◎ · CA ○" }],
  ]);
});

test.skipIf(process.platform !== "darwin")(
  "keeps a confirmed reading when the other read reports no device",
  async () => {
    // Given
    createSupportDirectory();
    vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(new CliError("no-device"));
    // When
    await refreshAirPodsStatus();
    // Then
    expect(mockUpdateCommandMetadata).toHaveBeenCalledExactlyOnceWith({ subtitle: "Noise Cancellation ◉" });
  },
);

test.skipIf(process.platform !== "darwin")(
  "publishes disconnection when the other read fails transiently",
  async () => {
    // Given
    createSupportDirectory();
    vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
    vi.mocked(AirPodsControlCli.getListeningMode).mockRejectedValue(new CliError("no-device"));
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(new Error("timeout"));
    // When
    await refreshAirPodsStatus();
    // Then
    expect(mockUpdateCommandMetadata).toHaveBeenCalledExactlyOnceWith({ subtitle: "Not connected" });
  },
);

test.skipIf(process.platform !== "darwin")("stays silent when a background refresh detects disconnection", async () => {
  // Given
  createSupportDirectory();
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
  vi.mocked(AirPodsControlCli.getListeningMode).mockRejectedValue(new CliError("no-device"));
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(new CliError("no-device"));
  // When
  await runAirPodsStatusRefresh({ showFeedback: false });
  // Then
  expect(mockShowToast).not.toHaveBeenCalled();
  expect(mockUpdateCommandMetadata).toHaveBeenCalledWith({ subtitle: "Not connected" });
});

test.skipIf(process.platform !== "darwin")(
  "preserves a previously published subtitle after a transient total read failure",
  async () => {
    // Given
    createSupportDirectory();
    vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValueOnce("anc").mockRejectedValue(new Error("timeout"));
    vi.mocked(AirPodsControlCli.getConversationAwareness)
      .mockResolvedValueOnce("on")
      .mockRejectedValue(new Error("timeout"));
    // When
    await refreshAirPodsStatus();
    // Then
    expect(mockUpdateCommandMetadata).toHaveBeenCalledExactlyOnceWith({ subtitle: "Noise Cancellation ◉ · CA ●" });
    // When
    await refreshAirPodsStatus();
    // Then
    expect(mockUpdateCommandMetadata).toHaveBeenCalledExactlyOnceWith({ subtitle: "Noise Cancellation ◉ · CA ●" });
  },
);

test.skipIf(process.platform !== "darwin")(
  "dispatches neutral subtitles without querying the CLI during setup fallback",
  async () => {
    // Given
    createSupportDirectory();
    vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
    // When
    await resetAirPodsStatusSubtitles();
    // Then
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
  },
);

test.skipIf(process.platform !== "darwin")("logs rejected subtitle launches during setup fallback", async () => {
  // Given
  createSupportDirectory();
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
  const error = new Error("Cycle Listening Mode is disabled");
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  mockLaunchCommand.mockRejectedValueOnce(error);
  // When
  await resetAirPodsStatusSubtitles();
  // Then
  expect(consoleError).toHaveBeenCalledWith("Failed to dispatch Cycle Listening Mode subtitle refresh", error);
});

test.skipIf(process.platform !== "darwin")("stays silent on a scheduled refresh", async () => {
  // Given
  createSupportDirectory();
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
  // When
  await runAirPodsStatusRefresh({ showFeedback: false });
  // Then
  expect(mockShowToast).not.toHaveBeenCalled();
  expect(mockLaunchCommand).toHaveBeenCalledTimes(2);
});

test.skipIf(process.platform !== "darwin")(
  "logs each rejected subtitle launch while staying silent in the background",
  async () => {
    // Given
    createSupportDirectory();
    vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
    const listeningError = new Error("Cycle Listening Mode is disabled");
    const conversationError = new Error("Conversation Awareness is disabled");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockLaunchCommand.mockRejectedValueOnce(listeningError).mockRejectedValueOnce(conversationError);
    // When
    await runAirPodsStatusRefresh({ showFeedback: false });
    // Then
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
  },
);

test.skipIf(process.platform !== "darwin")(
  "keeps Raycast open and reports both confirmed states in a success toast",
  async () => {
    // Given
    createSupportDirectory();
    vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
    const toast = makeToast();
    mockShowToast.mockResolvedValueOnce(toast);
    // When
    await runAirPodsStatusRefresh({ showFeedback: true });
    // Then
    expect(mockShowToast).toHaveBeenCalledWith({
      style: Toast.Style.Animated,
      title: "Refreshing AirPods status...",
    });
    expect(toast.style).toBe(Toast.Style.Success);
    expect(toast.message).toBe("Listening: Noise Cancellation ◉ · Conversation Awareness: On ●");
    expect(toast.primaryAction).toBeUndefined();
    expect(toast.show).toHaveBeenCalledOnce();
  },
);

test.skipIf(process.platform !== "darwin")(
  "reports a subtitle launch failure while retaining both confirmed states",
  async () => {
    // Given
    createSupportDirectory();
    vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
    const toast = makeToast();
    const error = new Error("Cycle Listening Mode is disabled");
    mockShowToast.mockResolvedValueOnce(toast);
    mockLaunchCommand.mockRejectedValueOnce(error);
    // When
    await runAirPodsStatusRefresh({ showFeedback: true });
    // Then
    expect(toast.style).toBe(Toast.Style.Failure);
    expect(toast.message).toBe(
      "Listening: Noise Cancellation ◉ · Conversation Awareness: On ● · Listening Mode subtitle: Cycle Listening Mode is disabled",
    );
    expect(toast.primaryAction).toEqual(expect.objectContaining({ title: "Copy Error" }));
    // When
    await toast.primaryAction?.onAction(toast);
    // Then
    expect(Clipboard.copy).toHaveBeenCalledWith(toast.message);
    expect(toast.show).toHaveBeenCalledOnce();
  },
);

test.skipIf(process.platform !== "darwin")(
  "includes read and subtitle launch failures in manual feedback",
  async () => {
    // Given
    createSupportDirectory();
    vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
    const toast = makeToast();
    // When
    const readError = new CliError("unsupported");
    const launchError = new Error("Cycle Listening Mode is disabled");
    mockShowToast.mockResolvedValueOnce(toast);
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(readError);
    mockLaunchCommand.mockRejectedValueOnce(launchError);
    await runAirPodsStatusRefresh({ showFeedback: true });
    // Then
    expect(toast.style).toBe(Toast.Style.Failure);
    expect(toast.message).toContain("Listening: Noise Cancellation ◉");
    expect(toast.message).toContain("Conversation Awareness:");
    expect(toast.message).toContain("Listening Mode subtitle: Cycle Listening Mode is disabled");
    expect(toast.primaryAction).toEqual(expect.objectContaining({ title: "Copy Error" }));
    expect(toast.show).toHaveBeenCalledOnce();
  },
);

test.skipIf(process.platform !== "darwin")(
  "reports a partial refresh while preserving the confirmed status",
  async () => {
    // Given
    createSupportDirectory();
    vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
    const toast = makeToast();
    mockShowToast.mockResolvedValueOnce(toast);
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(new CliError("unsupported"));
    // When
    await runAirPodsStatusRefresh({ showFeedback: true });
    // Then
    expect(toast.style).toBe(Toast.Style.Failure);
    expect(toast.message).toContain("Listening: Noise Cancellation ◉");
    expect(toast.message).toContain("Conversation Awareness: This feature is not supported");
    expect(toast.primaryAction).toEqual(expect.objectContaining({ title: "Copy Error" }));
    expect(toast.show).toHaveBeenCalledOnce();
  },
);

test.skipIf(process.platform !== "darwin")(
  "reports disconnection as a normal status without error actions",
  async () => {
    // Given
    createSupportDirectory();
    vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
    const toast = makeToast();
    mockShowToast.mockResolvedValueOnce(toast);
    vi.mocked(AirPodsControlCli.getListeningMode).mockRejectedValue(new CliError("no-device"));
    vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(new CliError("no-device"));
    // When
    await runAirPodsStatusRefresh({ showFeedback: true });
    // Then
    expect(toast.style).toBe(Toast.Style.Success);
    expect(toast.primaryAction).toBeUndefined();
    expect(toast.secondaryAction).toBeUndefined();
    expect(toast.show).toHaveBeenCalledOnce();
  },
);

test.skipIf(process.platform !== "darwin")("still reports subtitle dispatch failures when disconnected", async () => {
  // Given
  createSupportDirectory();
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("on");
  const toast = makeToast();
  mockShowToast.mockResolvedValueOnce(toast);
  vi.mocked(AirPodsControlCli.getListeningMode).mockRejectedValue(new CliError("no-device"));
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(new CliError("no-device"));
  mockLaunchCommand.mockRejectedValueOnce(new Error("Cycle Listening Mode is disabled"));
  // When
  await runAirPodsStatusRefresh({ showFeedback: true });
  // Then
  expect(toast.style).toBe(Toast.Style.Failure);
  expect(toast.message).toContain("Cycle Listening Mode is disabled");
  expect(toast.primaryAction).toEqual(expect.objectContaining({ title: "Copy Error" }));
  expect(toast.show).toHaveBeenCalledOnce();
});
