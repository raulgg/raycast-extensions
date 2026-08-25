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

  it("session-paces OpenCode Go primary as unsupported in the GUI", () => {
    expect(
      resolveSlotPace("opencodego", "Primary", { windowMinutes: 300, resetsAt: "2026-03-23T13:00:00Z" }, now),
    ).toBeUndefined();
  });
});
