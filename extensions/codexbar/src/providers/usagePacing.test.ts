import { describe, expect, it } from "vitest";
import { calculateWeeklyUsagePacing, formatUsagePacingLabels } from "./usagePacing";

describe("provider usage pacing", () => {
  it("calculates reserve usage pacing for resettable weekly windows", () => {
    const usagePacing = calculateWeeklyUsagePacing(
      {
        usedPercent: 53,
        remainingPercent: 47,
        resetsAt: "2026-04-17T00:17:00Z",
        windowMinutes: 10_080,
      },
      Date.parse("2026-04-16T12:30:00Z"),
    );

    expect(usagePacing).toMatchObject({
      stage: "farUnder",
      lastsUntilReset: true,
      actualUsedPercent: 53,
    });
    expect(usagePacing?.idealUsedPercentByNow).toBeCloseTo(92.98, 1);
    expect(usagePacing?.usedVsIdealDeltaPercent).toBeCloseTo(-39.98, 1);
    expect(formatUsagePacingLabels(usagePacing!)).toEqual({
      leftLabel: "40% behind",
      rightLabel: "Lasts until reset",
    });
  });

  it("suppresses usage pacing before enough weekly signal exists", () => {
    const usagePacing = calculateWeeklyUsagePacing(
      {
        usedPercent: 12,
        remainingPercent: 88,
        resetsAt: "2026-03-30T08:00:00Z",
        windowMinutes: 10_080,
      },
      Date.parse("2026-03-23T10:30:00Z"),
    );

    expect(usagePacing).toBeUndefined();
  });

  it("adjusts eta labels relative to computed timestamp", () => {
    const usagePacing = calculateWeeklyUsagePacing(
      {
        usedPercent: 90,
        remainingPercent: 10,
        resetsAt: "2026-04-18T20:00:00Z",
        windowMinutes: 10_080,
      },
      Date.parse("2026-04-16T12:00:00Z"),
    );

    expect(usagePacing?.lastsUntilReset).toBe(false);
    expect(formatUsagePacingLabels(usagePacing!, Date.parse("2026-04-16T13:00:00Z")).leftLabel).toBe("23% ahead");
    expect(formatUsagePacingLabels(usagePacing!, Date.parse("2026-04-16T13:00:00Z")).rightLabel).toBe(
      "Runs out in 11h 27m",
    );
  });
});
