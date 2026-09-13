import { getPreferenceValues, launchCommand, LaunchType, openCommandPreferences } from "@raycast/api";
import { expect, vi, test } from "vitest";
import * as AirPodsControlCli from "../../cli/client";
import { CliError } from "../../cli/errors";
import { runToggleConversationAwarenessCommand } from "../../controls/conversation-awareness";
import { runCycleListeningModeCommand, runSetListeningModeCommand } from "../../controls/listening-mode";
import { ToastManager } from "../../feedback/toast-manager";
import { publishCommandSubtitle, resetCommandSubtitle, withSubtitleOperation } from "../../subtitles/coordination";
import { refreshConversationAwarenessSubtitle, refreshListeningModeSubtitle } from "../../subtitles/feature-subtitles";
import type { CycleCommandPreferences } from "../../controls/preferences";

vi.mock("../../cli/client", async (importOriginal) => ({
  ...(await importOriginal<typeof AirPodsControlCli>()),
  cycleListeningMode: vi.fn(),
  getConversationAwareness: vi.fn(),
  getListeningMode: vi.fn(),
  setConversationAwareness: vi.fn(),
  setListeningMode: vi.fn(),
}));

vi.mock("../../subtitles/coordination", () => ({
  publishCommandSubtitle: vi.fn(),
  resetCommandSubtitle: vi.fn(),
  withSubtitleOperation: vi.fn(async (_channel, operation) => operation("test-revision")),
}));

vi.mock("../../feedback/toast-manager", () => ({
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

test.each([
  ["set", () => runSetListeningModeCommand("adaptive", { updateCycleSubtitle: true })],
  ["fallback set", () => runSetListeningModeCommand("adaptive", { updateCycleSubtitle: false })],
  ["cycle", runCycleListeningModeCommand],
  ["toggle", runToggleConversationAwarenessCommand],
] as const)("requests status synchronization after %s releases its lock", async (_name, run) => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
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
  // When
  await run();
  // Then
  expect(launchCommand).toHaveBeenCalledExactlyOnceWith({
    name: "refresh-airpods-status",
    type: LaunchType.Background,
  });
});

test("requests reconciliation after a failed control attempt", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  vi.mocked(AirPodsControlCli.setListeningMode).mockRejectedValueOnce(new CliError("no-device"));
  // When
  await runSetListeningModeCommand("adaptive", { updateCycleSubtitle: true });
  // Then
  expect(toast.setToFailure).toHaveBeenCalledOnce();
  expect(launchCommand).toHaveBeenCalledOnce();
});

test("preserves control success when the status command is disabled", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(launchCommand).mockRejectedValueOnce(new Error("command disabled"));
  // When
  const result = runSetListeningModeCommand("adaptive", { updateCycleSubtitle: true });
  // Then
  await expect(result).resolves.toBeUndefined();
  expect(toast.setToSuccess).toHaveBeenCalledOnce();
  expect(toast.setToFailure).not.toHaveBeenCalled();
});

test("does not launch a refresh when the control lock cannot be acquired", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  vi.mocked(withSubtitleOperation).mockRejectedValueOnce(new Error("lock unavailable"));
  // When
  await runSetListeningModeCommand("adaptive", { updateCycleSubtitle: true });
  // Then
  expect(AirPodsControlCli.setListeningMode).not.toHaveBeenCalled();
  expect(launchCommand).not.toHaveBeenCalled();
});

test("does not launch another refresh from subtitle-only background reads", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  // When
  await refreshListeningModeSubtitle();
  await refreshConversationAwarenessSubtitle();
  // Then
  expect(launchCommand).not.toHaveBeenCalled();
});

test("publishes the current listening mode without changing it or showing feedback", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("anc");
  // When
  await refreshListeningModeSubtitle();
  // Then
  expect(AirPodsControlCli.getListeningMode).toHaveBeenCalledOnce();
  expect(mockPublishCommandSubtitle).toHaveBeenCalledWith("Noise Cancellation ◉", {
    channel: "listening-mode",
    revision: "test-revision",
  });
  expect(AirPodsControlCli.cycleListeningMode).not.toHaveBeenCalled();
  expect(AirPodsControlCli.setListeningMode).not.toHaveBeenCalled();
  expect(mockToastManager).not.toHaveBeenCalled();
});

test("restores AirPods when the listening mode cannot be read", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  vi.mocked(AirPodsControlCli.getListeningMode).mockRejectedValue(new CliError("no-device"));
  // When
  const result = refreshListeningModeSubtitle();
  // Then
  await expect(result).resolves.toBeUndefined();
  expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
  expect(mockResetCommandSubtitle).toHaveBeenCalledOnce();
  expect(mockToastManager).not.toHaveBeenCalled();
});

test("publishes the current Conversation Awareness state without changing it or showing feedback", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  // When
  await refreshConversationAwarenessSubtitle();
  // Then
  expect(AirPodsControlCli.getConversationAwareness).toHaveBeenCalledOnce();
  expect(mockPublishCommandSubtitle).toHaveBeenCalledWith("Off ○", {
    channel: "conversation-awareness",
    revision: "test-revision",
  });
  expect(AirPodsControlCli.setConversationAwareness).not.toHaveBeenCalled();
  expect(mockToastManager).not.toHaveBeenCalled();
});

test("restores AirPods when Conversation Awareness cannot be read", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(new CliError("unsupported"));
  // When
  const result = refreshConversationAwarenessSubtitle();
  // Then
  await expect(result).resolves.toBeUndefined();
  expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
  expect(mockResetCommandSubtitle).toHaveBeenCalledOnce();
  expect(mockToastManager).not.toHaveBeenCalled();
});

test("publishes the confirmed mode after setting it", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("anc");
  // When
  await runSetListeningModeCommand("anc", { updateCycleSubtitle: true });
  // Then
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

test("does not update the fixed command subtitle in the disabled-Cycle fallback", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  // When
  await runSetListeningModeCommand("transparency", { updateCycleSubtitle: false });
  // Then
  expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
  expect(toast.setToSuccess).toHaveBeenCalledWith({ titleOverride: "Set to Transparency ◎" });
});

test("publishes a confirmed remaining state from a failed change", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  // When
  const error = new CliError("no-op", {
    result: "error",
    device: "My AirPods Pro",
    listeningMode: "transparency",
  });
  vi.mocked(AirPodsControlCli.setListeningMode).mockRejectedValue(error);
  await runSetListeningModeCommand("anc", { updateCycleSubtitle: true });
  // Then
  expect(mockPublishCommandSubtitle).toHaveBeenCalledExactlyOnceWith("Transparency ◎", {
    channel: "listening-mode",
    revision: "test-revision",
  });
  expect(toast.setToFailure).toHaveBeenCalledWith({ error });
  expect(toast.setToSuccess).not.toHaveBeenCalled();
});

test("keeps the Off-specific failure guidance", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  vi.mocked(AirPodsControlCli.setListeningMode).mockRejectedValue(new CliError("no-op"));
  // When
  await runSetListeningModeCommand("off", { updateCycleSubtitle: true });
  // Then
  expect(toast.setToFailure).toHaveBeenCalledWith({
    titleOverride: "Off mode was not applied",
    error: expect.objectContaining({ message: expect.stringContaining("Off may be disabled") }),
  });
  expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
  expect(mockResetCommandSubtitle).toHaveBeenCalledOnce();
});

test("restores AirPods after an unexpected failure", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  vi.mocked(AirPodsControlCli.setListeningMode).mockRejectedValue(new Error("unexpected"));
  // When
  await runSetListeningModeCommand("adaptive", { updateCycleSubtitle: true });
  // Then
  expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
  expect(mockResetCommandSubtitle).toHaveBeenCalledOnce();
});

test("publishes the confirmed mode after cycling", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("adaptive");
  // When
  await runCycleListeningModeCommand();
  // Then
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

test.each([
  ["zero", { cycleOff: false, cycleTransparency: false, cycleAdaptive: false, cycleAnc: false }],
  ["one", { cycleOff: false, cycleTransparency: true, cycleAdaptive: false, cycleAnc: false }],
] as const)("rejects %s selected cycle modes before reading or writing", async (_count, preferences) => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  mockGetPreferenceValues.mockReturnValue(preferences as never);
  // When
  await runCycleListeningModeCommand();
  // Then
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

test("passes the selected modes to the CLI in canonical order", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  mockGetPreferenceValues.mockReturnValue({
    cycleOff: false,
    cycleTransparency: true,
    cycleAdaptive: false,
    cycleAnc: true,
  } as never);
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("anc");
  // When
  await runCycleListeningModeCommand();
  // Then
  expect(AirPodsControlCli.cycleListeningMode).toHaveBeenCalledWith(["transparency", "anc"]);
  expect(mockPublishCommandSubtitle).toHaveBeenCalledExactlyOnceWith("Noise Cancellation ◉", {
    channel: "listening-mode",
    revision: "test-revision",
  });
});

test("publishes confirmed state while preserving selected-mode failure guidance", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  // When
  const error = new CliError("unsupported", {
    result: "error",
    device: "My AirPods Pro",
    listeningMode: "noise-cancellation",
  });
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockRejectedValue(error);
  await runCycleListeningModeCommand();
  // Then
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

test("restores AirPods when cycling fails without a confirmed mode", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockRejectedValue(new CliError("no-op"));
  // When
  await runCycleListeningModeCommand();
  // Then
  expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
  expect(mockResetCommandSubtitle).toHaveBeenCalledOnce();
});

test("publishes the confirmed state after toggling", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  // When
  await runToggleConversationAwarenessCommand();
  // Then
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

test("publishes the confirmed state from a failed toggle", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  // When
  const error = new CliError("no-op", {
    result: "error",
    device: "My AirPods Pro",
    conversationAwareness: "off",
  });
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockRejectedValue(error);
  await runToggleConversationAwarenessCommand();
  // Then
  expect(mockPublishCommandSubtitle).toHaveBeenCalledExactlyOnceWith("Off ○", {
    channel: "conversation-awareness",
    revision: "test-revision",
  });
  expect(toast.setToFailure).toHaveBeenCalledWith({ error });
});

test("preserves unsupported-device feedback", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockRejectedValue(new CliError("unsupported"));
  // When
  await runToggleConversationAwarenessCommand();
  // Then
  expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
  expect(mockResetCommandSubtitle).toHaveBeenCalledOnce();
  expect(toast.setToFailure).toHaveBeenCalledWith({
    titleOverride: "Conversation Awareness not supported",
    error: expect.objectContaining({ message: expect.stringContaining("doesn't support") }),
  });
});

test("restores AirPods when a toggle fails without a confirmed state", async () => {
  // Given
  const toast = {
    setToLoading: vi.fn().mockResolvedValue(undefined),
    setToSuccess: vi.fn().mockResolvedValue(undefined),
    setToFailure: vi.fn().mockResolvedValue(undefined),
  };
  mockToastManager.mockImplementation(function (this: unknown) {
    Object.assign(this as object, toast);
    return this as ToastManager;
  });
  mockGetPreferenceValues.mockReturnValue({ ...defaultCyclePreferences } as never);
  vi.mocked(AirPodsControlCli.setListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.cycleListeningMode).mockResolvedValue("transparency");
  vi.mocked(AirPodsControlCli.getConversationAwareness).mockResolvedValue("off");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockResolvedValue("on");
  vi.mocked(AirPodsControlCli.setConversationAwareness).mockRejectedValue(new CliError("no-op"));
  // When
  await runToggleConversationAwarenessCommand();
  // Then
  expect(mockPublishCommandSubtitle).not.toHaveBeenCalled();
  expect(mockResetCommandSubtitle).toHaveBeenCalledOnce();
});
