import { describe, expect, it } from "vitest";
import { calculateUsagePacing, formatUsagePacingLabels } from "./usagePacing";

describe("provider usage pacing", () => {
  it("calculates reserve usage pacing for resettable weekly windows", () => {
    const usagePacing = calculateUsagePacing(
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
    if (!usagePacing) {
      throw new Error("Expected usage pacing");
    }

    expect(formatUsagePacingLabels(usagePacing)).toEqual({
      leftLabel: "40% in reserve",
      rightLabel: "Lasts until reset",
    });
  });

  it("suppresses usage pacing before enough weekly signal exists", () => {
    const usagePacing = calculateUsagePacing(
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
    const usagePacing = calculateUsagePacing(
      {
        usedPercent: 90,
        remainingPercent: 10,
        resetsAt: "2026-04-18T20:00:00Z",
        windowMinutes: 10_080,
      },
      Date.parse("2026-04-16T12:00:00Z"),
    );

    expect(usagePacing?.lastsUntilReset).toBe(false);
    if (!usagePacing) {
      throw new Error("Expected usage pacing");
    }

    expect(formatUsagePacingLabels(usagePacing, Date.parse("2026-04-16T13:00:00Z")).leftLabel).toBe("23% in deficit");
    expect(formatUsagePacingLabels(usagePacing, Date.parse("2026-04-16T13:00:00Z")).rightLabel).toBe(
      "Runs out in 11h 27m",
    );
  });

  it("uses session-window ETA phrasing when the pace carries session context", () => {
    const usagePacing = calculateUsagePacing(
      {
        usedPercent: 90,
        remainingPercent: 10,
        resetsAt: "2026-04-18T20:00:00Z",
        windowMinutes: 10_080,
      },
      Date.parse("2026-04-16T12:00:00Z"),
    );
    if (!usagePacing) {
      throw new Error("Expected usage pacing");
    }

    const sessionPacing = { ...usagePacing, context: "session" as const };
    const labels = formatUsagePacingLabels(sessionPacing, Date.parse("2026-04-16T13:00:00Z"));
    expect(labels.leftLabel).toBe("23% in deficit");
    expect(labels.rightLabel).toBe("Projected empty in 11h 27m");
  });

  it("keeps the lasts-until-reset ETA phrasing identical across contexts", () => {
    const usagePacing = calculateUsagePacing(
      {
        usedPercent: 53,
        remainingPercent: 47,
        resetsAt: "2026-04-17T00:17:00Z",
        windowMinutes: 10_080,
      },
      Date.parse("2026-04-16T12:30:00Z"),
    );
    if (!usagePacing) {
      throw new Error("Expected usage pacing");
    }

    expect(formatUsagePacingLabels({ ...usagePacing, context: "session" }).rightLabel).toBe("Lasts until reset");
    expect(formatUsagePacingLabels({ ...usagePacing, context: "window" }).rightLabel).toBe("Lasts until reset");
  });
});
