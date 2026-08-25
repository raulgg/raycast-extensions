import { describe, expect, it } from "vitest";
import { inferredMonthlyWindowMinutes, resolveSlotPace } from "./paceCapabilities";

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
});
