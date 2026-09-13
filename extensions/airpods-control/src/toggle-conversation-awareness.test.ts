import { LaunchType, type LaunchProps } from "@raycast/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runToggleConversationAwarenessCommand } from "./controls/conversation-awareness";
import { runWithCliGuard } from "./helper-setup/guard";
import { resetCommandSubtitle } from "./subtitles/coordination";
import {
  publishConversationAwarenessSubtitle,
  refreshConversationAwarenessSubtitle,
} from "./subtitles/feature-subtitles";
import main from "./toggle-conversation-awareness";
import type { ConversationAwarenessSubtitleRefreshContext } from "./commands/launch-context";

vi.mock("./subtitles/feature-subtitles", () => ({
  publishConversationAwarenessSubtitle: vi.fn(),
  refreshConversationAwarenessSubtitle: vi.fn(),
}));
vi.mock("./controls/conversation-awareness", () => ({
  runToggleConversationAwarenessCommand: vi.fn(),
}));

vi.mock("./helper-setup/guard", () => ({
  runWithCliGuard: vi.fn(async (perform: () => Promise<void>) => perform()),
}));

vi.mock("./subtitles/coordination", () => ({
  resetCommandSubtitle: vi.fn(),
}));

type Props = LaunchProps<{ launchContext?: ConversationAwarenessSubtitleRefreshContext }>;

function props(
  launchType: LaunchType = LaunchType.UserInitiated,
  launchContext?: ConversationAwarenessSubtitleRefreshContext,
): Props {
  return { launchType, arguments: undefined, launchContext } as unknown as Props;
}

describe("Toggle Conversation Awareness entry point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves current status and restores AirPods only when the CLI is unavailable", async () => {
    await main(props());

    expect(refreshConversationAwarenessSubtitle).not.toHaveBeenCalled();
    expect(resetCommandSubtitle).not.toHaveBeenCalled();
    expect(runWithCliGuard).toHaveBeenCalledWith(runToggleConversationAwarenessCommand, {
      onUnavailable: expect.any(Function),
    });
    expect(runToggleConversationAwarenessCommand).toHaveBeenCalledOnce();
  });

  it("only refreshes the subtitle during a background launch", async () => {
    await main(props(LaunchType.Background));

    expect(refreshConversationAwarenessSubtitle).toHaveBeenCalledOnce();
    expect(publishConversationAwarenessSubtitle).not.toHaveBeenCalled();
    expect(runWithCliGuard).not.toHaveBeenCalled();
    expect(runToggleConversationAwarenessCommand).not.toHaveBeenCalled();
  });

  it("publishes coordinator state during a background launch without reading or toggling", async () => {
    await main(
      props(LaunchType.Background, {
        operation: "refresh-conversation-awareness-subtitle",
        state: "on",
        revision: "read-revision",
      }),
    );

    expect(publishConversationAwarenessSubtitle).toHaveBeenCalledWith("on", "read-revision");
    expect(refreshConversationAwarenessSubtitle).not.toHaveBeenCalled();
    expect(runWithCliGuard).not.toHaveBeenCalled();
    expect(runToggleConversationAwarenessCommand).not.toHaveBeenCalled();
  });

  it("resets the coordinator-owned subtitle during a background launch", async () => {
    await main(
      props(LaunchType.Background, {
        operation: "refresh-conversation-awareness-subtitle",
        state: null,
        revision: "read-revision",
      }),
    );

    expect(publishConversationAwarenessSubtitle).toHaveBeenCalledWith(null, "read-revision");
    expect(runToggleConversationAwarenessCommand).not.toHaveBeenCalled();
  });

  it("rejects user-initiated refresh context without toggling", async () => {
    await expect(
      main(
        props(LaunchType.UserInitiated, {
          operation: "refresh-conversation-awareness-subtitle",
          state: "off",
          revision: "read-revision",
        }),
      ),
    ).rejects.toThrow("invalid launch context");

    expect(resetCommandSubtitle).toHaveBeenCalledWith({ channel: "conversation-awareness" });
    expect(runWithCliGuard).not.toHaveBeenCalled();
    expect(runToggleConversationAwarenessCommand).not.toHaveBeenCalled();
  });
});
