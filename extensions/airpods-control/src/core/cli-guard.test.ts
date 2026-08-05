import { Clipboard, Keyboard, launchCommand, type Toast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isCliInstalled } from "./cli";
import { runWithCliGuard } from "./cli-guard";
import { INSTALL_CLI_COMMAND_NAME } from "./consts";

vi.mock("./cli", () => ({
  isCliInstalled: vi.fn(),
}));

const mockIsCliInstalled = vi.mocked(isCliInstalled);
const mockClipboardCopy = vi.mocked(Clipboard.copy);
const mockLaunchCommand = vi.mocked(launchCommand);
const mockShowFailureToast = vi.mocked(showFailureToast);

describe("cli-guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCliInstalled.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should run the action when the CLI is installed", async () => {
    const perform = vi.fn().mockResolvedValue(undefined);

    await runWithCliGuard(perform);

    expect(perform).toHaveBeenCalled();
    expect(mockLaunchCommand).not.toHaveBeenCalled();
  });

  it("should open the install command instead of running the action when the CLI is missing", async () => {
    mockIsCliInstalled.mockReturnValue(false);
    const perform = vi.fn();
    const onUnavailable = vi.fn().mockResolvedValue(undefined);

    await runWithCliGuard(perform, { onUnavailable });

    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(mockLaunchCommand).toHaveBeenCalledWith(expect.objectContaining({ name: INSTALL_CLI_COMMAND_NAME }));
    expect(perform).not.toHaveBeenCalled();
  });

  it("should not run unavailable cleanup when the CLI is installed", async () => {
    const perform = vi.fn().mockResolvedValue(undefined);
    const onUnavailable = vi.fn().mockResolvedValue(undefined);

    await runWithCliGuard(perform, { onUnavailable });

    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("should show a copyable failure toast when the action rejects unexpectedly", async () => {
    const error = new Error("boom");
    const perform = vi.fn().mockRejectedValue(error);

    await runWithCliGuard(perform);

    expect(mockShowFailureToast).toHaveBeenCalledWith(error, {
      title: "AirPods command failed",
      message: error.message,
      primaryAction: expect.objectContaining({
        title: "Copy Error",
        shortcut: Keyboard.Shortcut.Common.Copy,
      }),
    });

    const options = mockShowFailureToast.mock.calls[0][1];
    await options?.primaryAction?.onAction({} as Toast);
    expect(mockClipboardCopy).toHaveBeenCalledWith(error.message);
  });
});
