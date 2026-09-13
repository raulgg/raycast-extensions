import { describe, expect, it } from "vitest";
import {
  modeFromLaunchContext,
  listeningModeFromSubtitleRefreshContext,
  conversationAwarenessFromSubtitleRefreshContext,
} from "./launch-context";
describe("command launch contexts", () => {
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
