import { describe, expect, it } from "vitest";
import {
  conversationAwarenessHud,
  conversationAwarenessSubtitle,
  listeningModeHud,
  listeningModeSubtitle,
} from "./presentation";

describe("state presentation", () => {
  it.each([
    ["off", "Off ○̸", "Set to Off ○̸"],
    ["transparency", "Transparency ○", "Set to Transparency ○"],
    ["adaptive", "Adaptive ◑", "Set to Adaptive ◑"],
    ["anc", "Noise Cancellation ●", "Set to Noise Cancellation ●"],
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
});
