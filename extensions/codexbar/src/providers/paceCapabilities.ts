import type { ProviderUsagePacingContext } from "./types";

export const SESSION_PACE_DEFAULT_WINDOW_MINUTES = 300;
export const WEEKLY_PACE_DEFAULT_WINDOW_MINUTES = 10_080;
export const MONTHLY_WINDOW_SENTINEL_MINUTES = 30 * 24 * 60;

export type PaceCustomId =
  | "antigravitySession"
  | "claudeSessionAlways"
  | "codexSessionRejectsWeeklyMonthly"
  | "grokWeeklyCredits"
  | "notionRollingSession"
  | "zaiMonthlyMcp";

export type PaceWindowRule =
  | { type: "unsupported" }
  | { type: "resetDatePresent" }
  | { type: "windowDurationPresent" }
  | { type: "windowDuration"; minutes: number }
  | { type: "custom"; id: PaceCustomId };

export type PaceDurationRule =
  | { type: "unsupported" }
  | { type: "windowDurationMissing" }
  | { type: "windowDuration"; minutes: number }
  | { type: "custom"; id: PaceCustomId };

export type PaceCapability = {
  resetWindowPace: PaceWindowRule;
  inferredMonthlyDuration: PaceDurationRule;
  sessionPaceWindowRule: PaceWindowRule;
  secondarySessionPace?: boolean;
  secondaryAllowsDefaultWindow?: boolean;
};

export type PaceWindow = {
  windowMinutes?: number;
  resetsAt?: string;
  resetDescription?: string;
};

export type ResolvedSlotPace = {
  context: ProviderUsagePacingContext;
  defaultWindowMinutes: number;
  windowMinutes?: number;
};

const UNSUPPORTED: PaceCapability = {
  resetWindowPace: { type: "unsupported" },
  inferredMonthlyDuration: { type: "unsupported" },
  sessionPaceWindowRule: { type: "unsupported" },
};

export function grokWindowDurationMs(
  windowMinutes: number | undefined,
  resetsAt: string | undefined,
  now: number,
): number {
  if (windowMinutes !== undefined) {
    return windowMinutes * 60 * 1000;
  }

  if (resetsAt) {
    return Date.parse(resetsAt) - now;
  }

  return Number.NaN;
}

// Mirrors GrokProviderDescriptor.primaryLabel(duration:).
export function grokPrimaryDisplayTitle(durationMs: number): string | undefined {
  if (!Number.isFinite(durationMs) || durationMs <= 60 * 60 * 1000) {
    return undefined;
  }

  const days = Math.round(durationMs / (24 * 60 * 60 * 1000));
  if (days >= 4 && days <= 12) {
    return "Weekly";
  }

  if (days >= 20 && days <= 45) {
    return "Monthly";
  }

  return undefined;
}

function grokWeeklyCredits(window: PaceWindow, now: number): boolean {
  if (!window.resetsAt) {
    return false;
  }

  if (grokPrimaryDisplayTitle(grokWindowDurationMs(window.windowMinutes, window.resetsAt, now)) !== "Weekly") {
    return false;
  }

  const resetAtMs = Date.parse(window.resetsAt);
  if (Number.isNaN(resetAtMs)) {
    return false;
  }

  const windowMinutes = window.windowMinutes ?? WEEKLY_PACE_DEFAULT_WINDOW_MINUTES;
  const timeUntilResetSeconds = (resetAtMs - now) / 1000;
  return windowMinutes > 0 && timeUntilResetSeconds > 0 && timeUntilResetSeconds <= windowMinutes * 60;
}

export const CUSTOM_WINDOW_RULES: Record<PaceCustomId, (window: PaceWindow, now: number) => boolean> = {
  antigravitySession: (window) => window.windowMinutes === undefined || window.windowMinutes === 300,
  claudeSessionAlways: () => true,
  codexSessionRejectsWeeklyMonthly: (window) => {
    if (window.windowMinutes === undefined) {
      return true;
    }

    return window.windowMinutes !== 7 * 24 * 60 && window.windowMinutes !== 30 * 24 * 60;
  },
  grokWeeklyCredits,
  notionRollingSession: (window) => window.windowMinutes !== undefined && window.windowMinutes <= 6 * 60,
  zaiMonthlyMcp: (window) =>
    window.windowMinutes === MONTHLY_WINDOW_SENTINEL_MINUTES && window.resetDescription === "MCP",
};

function matchWindowRule(rule: PaceWindowRule, window: PaceWindow, now: number): boolean {
  switch (rule.type) {
    case "unsupported":
      return false;
    case "resetDatePresent":
      return window.resetsAt !== undefined;
    case "windowDurationPresent":
      return window.windowMinutes !== undefined;
    case "windowDuration":
      return window.windowMinutes === rule.minutes;
    case "custom":
      return CUSTOM_WINDOW_RULES[rule.id](window, now);
  }
}

function matchDurationRule(rule: PaceDurationRule, window: PaceWindow, now: number): boolean {
  switch (rule.type) {
    case "unsupported":
      return false;
    case "windowDurationMissing":
      return window.windowMinutes === undefined;
    case "windowDuration":
      return window.windowMinutes === rule.minutes;
    case "custom":
      return CUSTOM_WINDOW_RULES[rule.id](window, now);
  }
}

function addUtcMonths(date: Date, delta: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + delta;
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(day, lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

export function inferredMonthlyWindowMinutes(resetsAt: string): number | undefined {
  const endMs = Date.parse(resetsAt);
  if (Number.isNaN(endMs)) {
    return undefined;
  }

  const end = new Date(endMs);
  const start = addUtcMonths(end, -1);
  const minutes = (endMs - start.getTime()) / 60_000;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return undefined;
  }

  return Math.round(minutes);
}

function resolveResetWindow(capability: PaceCapability, window: PaceWindow): PaceWindow {
  if (!matchDurationRule(capability.inferredMonthlyDuration, window, 0) || !window.resetsAt) {
    return window;
  }

  const minutes = inferredMonthlyWindowMinutes(window.resetsAt);
  if (minutes === undefined) {
    return window;
  }

  return { ...window, windowMinutes: minutes };
}

export function getPaceCapability(providerId: string): PaceCapability {
  return PACE_CAPABILITIES[providerId] ?? UNSUPPORTED;
}

export function resolveSlotPace(
  providerId: string,
  slot: "Primary" | "Secondary" | "Tertiary",
  window: PaceWindow,
  now: number,
): ResolvedSlotPace | undefined {
  const capability = getPaceCapability(providerId);
  const resetPace = (): ResolvedSlotPace | undefined => {
    if (!matchWindowRule(capability.resetWindowPace, window, now)) {
      return undefined;
    }

    const resolved = resolveResetWindow(capability, window);
    return {
      context: "window",
      defaultWindowMinutes: WEEKLY_PACE_DEFAULT_WINDOW_MINUTES,
      windowMinutes: resolved.windowMinutes,
    };
  };
  const sessionPace = (): ResolvedSlotPace | undefined => {
    if (!matchWindowRule(capability.sessionPaceWindowRule, window, now)) {
      return undefined;
    }

    return {
      context: "session",
      defaultWindowMinutes: SESSION_PACE_DEFAULT_WINDOW_MINUTES,
      windowMinutes: window.windowMinutes,
    };
  };

  if (slot === "Tertiary") {
    return resetPace();
  }

  if (slot === "Primary" || (slot === "Secondary" && capability.secondarySessionPace)) {
    return resetPace() ?? sessionPace();
  }

  const reset = resetPace();
  if (reset) {
    return reset;
  }

  if (window.windowMinutes === undefined && !capability.secondaryAllowsDefaultWindow) {
    return undefined;
  }

  return {
    context: "window",
    defaultWindowMinutes: WEEKLY_PACE_DEFAULT_WINDOW_MINUTES,
    windowMinutes: window.windowMinutes,
  };
}

const CALENDAR_MONTH: PaceCapability = {
  resetWindowPace: { type: "windowDuration", minutes: MONTHLY_WINDOW_SENTINEL_MINUTES },
  inferredMonthlyDuration: { type: "windowDuration", minutes: MONTHLY_WINDOW_SENTINEL_MINUTES },
  sessionPaceWindowRule: { type: "unsupported" },
};

export const PACE_CAPABILITIES: Record<string, PaceCapability> = {
  alibaba: CALENDAR_MONTH,
  alibabatokenplan: CALENDAR_MONTH,
  amp: CALENDAR_MONTH,
  antigravity: {
    resetWindowPace: { type: "unsupported" },
    inferredMonthlyDuration: { type: "unsupported" },
    sessionPaceWindowRule: { type: "custom", id: "antigravitySession" },
  },
  claude: {
    resetWindowPace: { type: "unsupported" },
    inferredMonthlyDuration: { type: "unsupported" },
    sessionPaceWindowRule: { type: "custom", id: "claudeSessionAlways" },
  },
  codex: {
    resetWindowPace: { type: "unsupported" },
    inferredMonthlyDuration: { type: "unsupported" },
    sessionPaceWindowRule: { type: "custom", id: "codexSessionRejectsWeeklyMonthly" },
    secondaryAllowsDefaultWindow: true,
  },
  commandcode: CALENDAR_MONTH,
  copilot: {
    resetWindowPace: { type: "resetDatePresent" },
    inferredMonthlyDuration: { type: "windowDurationMissing" },
    sessionPaceWindowRule: { type: "unsupported" },
  },
  cursor: {
    resetWindowPace: { type: "windowDurationPresent" },
    inferredMonthlyDuration: { type: "unsupported" },
    sessionPaceWindowRule: { type: "unsupported" },
  },
  doubao: CALENDAR_MONTH,
  grok: {
    resetWindowPace: { type: "custom", id: "grokWeeklyCredits" },
    inferredMonthlyDuration: { type: "unsupported" },
    sessionPaceWindowRule: { type: "unsupported" },
  },
  kimi: {
    resetWindowPace: { type: "windowDuration", minutes: 10_080 },
    inferredMonthlyDuration: { type: "unsupported" },
    sessionPaceWindowRule: { type: "windowDuration", minutes: 300 },
    secondarySessionPace: true,
  },
  mimo: CALENDAR_MONTH,
  notion: {
    ...CALENDAR_MONTH,
    sessionPaceWindowRule: { type: "custom", id: "notionRollingSession" },
  },
  ollama: {
    resetWindowPace: { type: "unsupported" },
    inferredMonthlyDuration: { type: "unsupported" },
    sessionPaceWindowRule: { type: "windowDurationPresent" },
  },
  opencodego: CALENDAR_MONTH,
  stepfun: CALENDAR_MONTH,
  zai: {
    resetWindowPace: { type: "custom", id: "zaiMonthlyMcp" },
    inferredMonthlyDuration: { type: "custom", id: "zaiMonthlyMcp" },
    sessionPaceWindowRule: { type: "windowDuration", minutes: 300 },
  },
};
