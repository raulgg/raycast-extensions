import type { ProviderUsagePacing, ProviderUsagePacingStage } from "./types";

const DEFAULT_WINDOW_MINUTES = 10_080;
const MINIMUM_WINDOW_ELAPSED_PERCENT = 3;

type UsagePacingWindowInput = {
  usedPercent: number;
  remainingPercent: number;
  resetsAt?: string;
  windowMinutes?: number;
};

type UsagePacingLabelSet = {
  leftLabel: string;
  rightLabel?: string;
};

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function stageForUsedVsIdealDelta(usedVsIdealDeltaPercent: number): ProviderUsagePacingStage {
  const absoluteDelta = Math.abs(usedVsIdealDeltaPercent);

  if (absoluteDelta <= 2) {
    return "onTrack";
  }

  if (absoluteDelta <= 6) {
    return usedVsIdealDeltaPercent >= 0 ? "slightlyOver" : "slightlyUnder";
  }

  if (absoluteDelta <= 12) {
    return usedVsIdealDeltaPercent >= 0 ? "over" : "under";
  }

  return usedVsIdealDeltaPercent >= 0 ? "farOver" : "farUnder";
}

export function calculateUsagePacing(
  window: UsagePacingWindowInput,
  computedAt = Date.now(),
  defaultWindowMinutes = DEFAULT_WINDOW_MINUTES,
): ProviderUsagePacing | undefined {
  if (window.remainingPercent <= 0 || !window.resetsAt) {
    return undefined;
  }

  const computedAtDate = new Date(computedAt);
  const resetAtDate = new Date(window.resetsAt);
  if (Number.isNaN(computedAtDate.getTime()) || Number.isNaN(resetAtDate.getTime())) {
    return undefined;
  }

  const minutes = window.windowMinutes ?? defaultWindowMinutes;
  if (minutes <= 0) {
    return undefined;
  }

  const durationSeconds = minutes * 60;
  const timeUntilResetSeconds = (resetAtDate.getTime() - computedAtDate.getTime()) / 1000;
  if (timeUntilResetSeconds <= 0 || timeUntilResetSeconds > durationSeconds) {
    return undefined;
  }

  const elapsedSeconds = Math.max(0, Math.min(durationSeconds, durationSeconds - timeUntilResetSeconds));
  const actualUsedPercent = clampPercent(window.usedPercent);

  if (elapsedSeconds === 0 && actualUsedPercent > 0) {
    return undefined;
  }

  const idealUsedPercentByNow = clampPercent((elapsedSeconds / durationSeconds) * 100);
  if (idealUsedPercentByNow < MINIMUM_WINDOW_ELAPSED_PERCENT) {
    return undefined;
  }

  const usedVsIdealDeltaPercent = actualUsedPercent - idealUsedPercentByNow;
  let runOutEtaSeconds: number | undefined;
  let lastsUntilReset = false;

  if (elapsedSeconds > 0 && actualUsedPercent > 0) {
    const burnRate = actualUsedPercent / elapsedSeconds;
    if (burnRate > 0) {
      const remainingPercent = Math.max(0, 100 - actualUsedPercent);
      const projectedSecondsRemaining = remainingPercent / burnRate;
      if (projectedSecondsRemaining >= timeUntilResetSeconds) {
        lastsUntilReset = true;
      } else {
        runOutEtaSeconds = projectedSecondsRemaining;
      }
    }
  } else if (elapsedSeconds > 0) {
    lastsUntilReset = true;
  }

  return {
    stage: stageForUsedVsIdealDelta(usedVsIdealDeltaPercent),
    usedVsIdealDeltaPercent,
    idealUsedPercentByNow,
    actualUsedPercent,
    runOutEtaSeconds,
    lastsUntilReset,
    computedAt: computedAtDate.toISOString(),
  };
}

function durationText(totalSeconds: number): string {
  const roundedMinutes = Math.max(0, Math.ceil(totalSeconds / 60));
  if (roundedMinutes <= 0) {
    return "now";
  }

  const minutesPerDay = 24 * 60;
  if (roundedMinutes < minutesPerDay) {
    const hours = Math.floor(roundedMinutes / 60);
    const minutes = roundedMinutes % 60;

    if (hours === 0) {
      return `${minutes}m`;
    }

    if (minutes === 0) {
      return `${hours}h`;
    }

    return `${hours}h ${minutes}m`;
  }

  const days = Math.floor(roundedMinutes / minutesPerDay);
  const hours = Math.floor((roundedMinutes % minutesPerDay) / 60);
  if (hours === 0) {
    return `${days}d`;
  }

  return `${days}d ${hours}h`;
}

function liveRunOutEtaSeconds(usagePacing: ProviderUsagePacing, now = Date.now()): number | undefined {
  if (usagePacing.runOutEtaSeconds === undefined) {
    return undefined;
  }

  const computedAtMs = Date.parse(usagePacing.computedAt);
  if (Number.isNaN(computedAtMs)) {
    return usagePacing.runOutEtaSeconds;
  }

  return Math.max(0, usagePacing.runOutEtaSeconds - (now - computedAtMs) / 1000);
}

// Label wording mirrors upstream UsagePaceText (detailLeftLabel / detailRightLabel).
// "in deficit" = consuming faster than the window's even pace; "in reserve" = slower.
export function formatUsagePacingLabels(usagePacing: ProviderUsagePacing, now = Date.now()): UsagePacingLabelSet {
  const roundedDeltaPercent = Math.round(Math.abs(usagePacing.usedVsIdealDeltaPercent));
  const leftLabel =
    usagePacing.stage === "onTrack" || roundedDeltaPercent === 0
      ? "On pace"
      : usagePacing.usedVsIdealDeltaPercent >= 0
        ? `${roundedDeltaPercent}% in deficit`
        : `${roundedDeltaPercent}% in reserve`;

  if (usagePacing.lastsUntilReset) {
    return {
      leftLabel,
      rightLabel: "Lasts until reset",
    };
  }

  const runOutEtaSeconds = liveRunOutEtaSeconds(usagePacing, now);
  if (runOutEtaSeconds === undefined) {
    return { leftLabel };
  }

  const etaText = durationText(runOutEtaSeconds);
  // The session window projects an "empty" ETA; weekly/other windows "run out".
  if (usagePacing.context === "session") {
    return {
      leftLabel,
      rightLabel: etaText === "now" ? "Projected empty now" : `Projected empty in ${etaText}`,
    };
  }

  return {
    leftLabel,
    rightLabel: etaText === "now" ? "Runs out now" : `Runs out in ${etaText}`,
  };
}
