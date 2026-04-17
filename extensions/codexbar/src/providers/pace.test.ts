import { describe, expect, it } from "vitest";
import { calculateWeeklyUsagePace, formatUsagePaceLabels } from "./pace";

describe("provider pace", () => {
  it("calculates reserve pace for resettable weekly windows", () => {
    const pace = calculateWeeklyUsagePace(
      {
        usedPercent: 53,
        remainingPercent: 47,
        resetsAt: "2026-04-17T00:17:00Z",
        windowMinutes: 10_080,
      },
      Date.parse("2026-04-16T12:30:00Z"),
    );

    expect(pace).toMatchObject({
      stage: "farBehind",
      willLastToReset: true,
      actualUsedPercent: 53,
    });
    expect(pace?.expectedUsedPercent).toBeCloseTo(92.98, 1);
    expect(pace?.deltaPercent).toBeCloseTo(-39.98, 1);
    expect(formatUsagePaceLabels(pace!)).toEqual({
      leftLabel: "40% behind pace",
      rightLabel: "Lasts until reset",
    });
  });

  it("suppresses pace before enough weekly signal exists", () => {
    const pace = calculateWeeklyUsagePace(
      {
        usedPercent: 12,
        remainingPercent: 88,
        resetsAt: "2026-03-30T08:00:00Z",
        windowMinutes: 10_080,
      },
      Date.parse("2026-03-23T10:30:00Z"),
    );

    expect(pace).toBeUndefined();
  });

  it("adjusts eta labels relative to computed timestamp", () => {
    const pace = calculateWeeklyUsagePace(
      {
        usedPercent: 90,
        remainingPercent: 10,
        resetsAt: "2026-04-18T20:00:00Z",
        windowMinutes: 10_080,
      },
      Date.parse("2026-04-16T12:00:00Z"),
    );

    expect(pace?.willLastToReset).toBe(false);
    expect(formatUsagePaceLabels(pace!, Date.parse("2026-04-16T13:00:00Z")).leftLabel).toBe("23% ahead of pace");
    expect(formatUsagePaceLabels(pace!, Date.parse("2026-04-16T13:00:00Z")).rightLabel).toBe("Runs out in 11h 27m");
  });
});
