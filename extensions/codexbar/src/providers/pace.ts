import type { ProviderUsagePace, ProviderUsagePaceStage } from "./types";

const DEFAULT_WEEKLY_WINDOW_MINUTES = 10_080;
const MINIMUM_EXPECTED_USED_PERCENT = 3;

type PaceWindowInput = {
  usedPercent: number;
  remainingPercent: number;
  resetsAt?: string;
  windowMinutes?: number;
};

type PaceLabelSet = {
  leftLabel: string;
  rightLabel?: string;
};

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function stageForDelta(deltaPercent: number): ProviderUsagePaceStage {
  const absoluteDelta = Math.abs(deltaPercent);

  if (absoluteDelta <= 2) {
    return "onTrack";
  }

  if (absoluteDelta <= 6) {
    return deltaPercent >= 0 ? "slightlyAhead" : "slightlyBehind";
  }

  if (absoluteDelta <= 12) {
    return deltaPercent >= 0 ? "ahead" : "behind";
  }

  return deltaPercent >= 0 ? "farAhead" : "farBehind";
}

export function calculateWeeklyUsagePace(
  window: PaceWindowInput,
  computedAt = Date.now(),
  defaultWindowMinutes = DEFAULT_WEEKLY_WINDOW_MINUTES,
): ProviderUsagePace | undefined {
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

  const expectedUsedPercent = clampPercent((elapsedSeconds / durationSeconds) * 100);
  if (expectedUsedPercent < MINIMUM_EXPECTED_USED_PERCENT) {
    return undefined;
  }

  const deltaPercent = actualUsedPercent - expectedUsedPercent;
  let etaSeconds: number | undefined;
  let willLastToReset = false;

  if (elapsedSeconds > 0 && actualUsedPercent > 0) {
    const burnRate = actualUsedPercent / elapsedSeconds;
    if (burnRate > 0) {
      const remainingPercent = Math.max(0, 100 - actualUsedPercent);
      const projectedSecondsRemaining = remainingPercent / burnRate;
      if (projectedSecondsRemaining >= timeUntilResetSeconds) {
        willLastToReset = true;
      } else {
        etaSeconds = projectedSecondsRemaining;
      }
    }
  } else if (elapsedSeconds > 0) {
    willLastToReset = true;
  }

  return {
    stage: stageForDelta(deltaPercent),
    deltaPercent,
    expectedUsedPercent,
    actualUsedPercent,
    etaSeconds,
    willLastToReset,
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

function liveEtaSeconds(pace: ProviderUsagePace, now = Date.now()): number | undefined {
  if (pace.etaSeconds === undefined) {
    return undefined;
  }

  const computedAtMs = Date.parse(pace.computedAt);
  if (Number.isNaN(computedAtMs)) {
    return pace.etaSeconds;
  }

  return Math.max(0, pace.etaSeconds - (now - computedAtMs) / 1000);
}

export function formatUsagePaceLabels(pace: ProviderUsagePace, now = Date.now()): PaceLabelSet {
  const roundedDeltaPercent = Math.round(Math.abs(pace.deltaPercent));
  const leftLabel =
    pace.stage === "onTrack"
      ? "On pace"
      : pace.deltaPercent >= 0
        ? `${roundedDeltaPercent}% ahead of pace`
        : `${roundedDeltaPercent}% behind pace`;

  if (pace.willLastToReset) {
    return {
      leftLabel,
      rightLabel: "Lasts until reset",
    };
  }

  const etaSeconds = liveEtaSeconds(pace, now);
  if (etaSeconds === undefined) {
    return { leftLabel };
  }

  const etaText = durationText(etaSeconds);
  return {
    leftLabel,
    rightLabel: etaText === "now" ? "Runs out now" : `Runs out in ${etaText}`,
  };
}
