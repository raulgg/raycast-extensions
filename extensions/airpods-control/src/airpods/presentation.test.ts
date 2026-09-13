import { describe, expect, it } from "vitest";
import {
  conversationAwarenessHud,
  conversationAwarenessSubtitle,
  formatAirPodsStatusSubtitle,
  listeningModeHud,
  listeningModeSubtitle,
} from "./presentation";

describe("state presentation", () => {
  it.each([
    ["off", "Off ○", "Set to Off ○"],
    ["transparency", "Transparency ◎", "Set to Transparency ◎"],
    ["adaptive", "Adaptive ◑", "Set to Adaptive ◑"],
    ["anc", "Noise Cancellation ◉", "Set to Noise Cancellation ◉"],
  ] as const)("formats %s listening mode", (mode, subtitle, hud) => {
    expect(listeningModeSubtitle(mode)).toBe(subtitle);
    expect(listeningModeHud(mode)).toBe(hud);
  });

  it.each([
    ["on", "On ●", "Conversation Awareness On ●"],
    ["off", "Off ○", "Conversation Awareness Off ○"],
  ] as const)("formats Conversation Awareness %s", (state, subtitle, hud) => {
    expect(conversationAwarenessSubtitle(state)).toBe(subtitle);
    expect(conversationAwarenessHud(state)).toBe(hud);
  });

  it.each([
    [{ listeningMode: "anc", conversationAwareness: "on" }, "Noise Cancellation ◉ · CA ●"],
    [{ listeningMode: "transparency", conversationAwareness: "off" }, "Transparency ◎ · CA ○"],
    [{ listeningMode: "adaptive", conversationAwareness: null }, "Adaptive ◑"],
    [{ listeningMode: null, conversationAwareness: "on" }, "CA ●"],
    [{ listeningMode: null, conversationAwareness: "off" }, "CA ○"],
    [{ listeningMode: "off", conversationAwareness: null }, "Off ○"],
    [{ listeningMode: null, conversationAwareness: null }, null],
  ] as const)("formats a combined status subtitle %#", (status, expected) => {
    expect(formatAirPodsStatusSubtitle(status)).toBe(expected);
  });
});
