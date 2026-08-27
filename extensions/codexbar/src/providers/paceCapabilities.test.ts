import { describe, expect, it } from "vitest";
import { calculateUsagePacing } from "./usagePacing";
import { inferredMonthlyWindowMinutes, resolveExtraWindowPace, resolveSlotPace } from "./paceCapabilities";

describe("inferredMonthlyWindowMinutes", () => {
  it("uses the previous calendar month in UTC, clamping the day", () => {
    expect(inferredMonthlyWindowMinutes("2026-03-31T00:00:00Z")).toBe(31 * 24 * 60);
    expect(inferredMonthlyWindowMinutes("2026-03-01T00:00:00Z")).toBe(28 * 24 * 60);
  });
});

describe("resolveSlotPace", () => {
  const now = Date.parse("2026-03-23T10:30:00Z");

  it("does not session-pace OpenCode Go's 5-hour primary", () => {
    expect(
      resolveSlotPace("opencodego", "Primary", { windowMinutes: 300, resetsAt: "2026-03-23T13:00:00Z" }, now),
    ).toBeUndefined();
  });

  it("does not generic-weekly-pace a factory tertiary, even mid-window", () => {
    expect(
      resolveSlotPace("factory", "Tertiary", { windowMinutes: 43_200, resetsAt: "2026-04-12T10:30:00Z" }, now),
    ).toBeUndefined();
  });

  it("rescored alibaba monthly sentinel is not 43_200 minutes", () => {
    const resolved = resolveSlotPace(
      "alibaba",
      "Tertiary",
      { windowMinutes: 43_200, resetsAt: "2026-04-22T10:30:00Z" },
      now,
    );
    expect(resolved?.context).toBe("window");
    expect(resolved?.windowMinutes).not.toBe(43_200);
    expect(resolved?.windowMinutes).toBe(inferredMonthlyWindowMinutes("2026-04-22T10:30:00Z"));
  });

  it("does not rewrite copilot duration when windowMinutes is present", () => {
    expect(
      resolveSlotPace("copilot", "Primary", { windowMinutes: 10_080, resetsAt: "2026-03-31T00:00:00Z" }, now)
        ?.windowMinutes,
    ).toBe(10_080);
  });

  it("paces a 31-day March window past the elapsed floor", () => {
    const reset = "2026-03-31T00:00:00Z";
    const resolved = resolveSlotPace("copilot", "Primary", { resetsAt: reset }, now);
    expect(resolved?.windowMinutes).toBe(31 * 24 * 60);
    expect(
      calculateUsagePacing(
        { usedPercent: 50, remainingPercent: 50, resetsAt: reset, windowMinutes: resolved?.windowMinutes },
        now,
        resolved?.defaultWindowMinutes,
      ),
    ).toMatchObject({ actualUsedPercent: 50 });
  });
});

describe("resolveExtraWindowPace", () => {
  it("session-paces Codex and Antigravity 5-hour extras, weekly-paces 7-day extras", () => {
    expect(resolveExtraWindowPace("codex", { windowMinutes: 300 })?.context).toBe("session");
    expect(resolveExtraWindowPace("antigravity", { windowMinutes: 300 })?.context).toBe("session");
    expect(resolveExtraWindowPace("codex", { windowMinutes: 10_080 })?.context).toBe("window");
    expect(resolveExtraWindowPace("claude", { windowMinutes: 10_080 })?.context).toBe("window");
  });

  it("does not pace Claude 5-hour extras or extras on other providers", () => {
    expect(resolveExtraWindowPace("claude", { windowMinutes: 300 })).toBeUndefined();
    expect(resolveExtraWindowPace("factory", { windowMinutes: 10_080 })).toBeUndefined();
    expect(resolveExtraWindowPace("zai", { windowMinutes: 43_200, resetDescription: "MCP" })).toBeUndefined();
  });
});
