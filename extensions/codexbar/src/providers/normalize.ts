import {
  grokPrimaryDisplayTitle,
  grokWindowDurationMs,
  resolveExtraWindowPace,
  resolveSlotPace,
} from "./paceCapabilities";
import { getProviderMetadata, getProviderUsageSectionDisplayTitle } from "./registry";
import { calculateUsagePacing } from "./usagePacing";
import { parseProviderStatus } from "./status";
import type {
  ProviderDetailData,
  ProviderSection,
  ProviderSectionItem,
  ProviderStatus,
  ProviderUsagePacing,
  RawProviderPayload,
} from "./types";

type ProviderCandidate = {
  id?: string;
  payload: RawProviderPayload;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecord(value: unknown): RawProviderPayload | undefined {
  return isRecord(value) ? value : undefined;
}

function toString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toTrimmedString(value: unknown): string | undefined {
  return toString(value)?.trim();
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const stringValue = toTrimmedString(value);
    if (stringValue) {
      return stringValue;
    }
  }

  return undefined;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(value);
}

function formatCurrency(value: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    }).format(value);
  } catch {
    return `${formatNumber(value)} ${currencyCode}`;
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function normalizePercentFromFraction(value: number): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  if (value >= 0 && value <= 1) {
    return value * 100;
  }

  if (value >= 0 && value <= 100) {
    return value;
  }

  return undefined;
}

function extractUpdatedAt(payload: RawProviderPayload): string | undefined {
  const usage = toRecord(payload.usage);
  const credits = toRecord(payload.credits);
  const dashboard = toRecord(payload.openaiDashboard);
  const status = toRecord(payload.status);

  return (
    toString(payload.updatedAt) ??
    toString(usage?.updatedAt) ??
    toString(credits?.updatedAt) ??
    toString(dashboard?.updatedAt) ??
    toString(status?.updatedAt)
  );
}

function extractResolvedSource(payload: RawProviderPayload): string | undefined {
  return toTrimmedString(payload.source);
}

function formatCountdown(isoTimestamp: string, now = Date.now()): string | undefined {
  const target = Date.parse(isoTimestamp);
  if (Number.isNaN(target)) {
    return undefined;
  }

  const diffMs = target - now;
  if (diffMs <= 0) {
    return undefined;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const totalMinutes = Math.ceil(diffMs / (60 * 1000));
  if (diffMs < dayMs) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) {
      return `${minutes}m`;
    }

    if (minutes === 0) {
      return `${hours}h`;
    }

    return `${hours}h ${minutes}m`;
  }

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);

  if (hours === 0) {
    return `${days}d`;
  }

  return `${days}d ${hours}h`;
}

function buildWindowReset(
  window: RawProviderPayload,
  fallbackResetTimestamp?: string,
  now?: number,
): string | undefined {
  const resetsAt = toString(window.resetsAt) ?? fallbackResetTimestamp;
  if (resetsAt) {
    return formatCountdown(resetsAt, now);
  }

  return undefined;
}

type UsagePacingInput = {
  usedPercent: number;
  remainingPercent: number;
  resetsAt: string;
  windowMinutes?: number;
  resetDescription?: string;
};

function computeExtraWindowUsagePacing(
  providerId: string,
  input: UsagePacingInput,
  now: number,
): ProviderUsagePacing | undefined {
  const resolved = resolveExtraWindowPace(providerId, {
    windowMinutes: input.windowMinutes,
    resetsAt: input.resetsAt,
    resetDescription: input.resetDescription,
  });
  if (!resolved) {
    return undefined;
  }

  const pacing = calculateUsagePacing(
    { ...input, windowMinutes: resolved.windowMinutes },
    now,
    resolved.defaultWindowMinutes,
  );
  return pacing ? { ...pacing, context: resolved.context } : undefined;
}

function computeSlotUsagePacing(
  providerId: string,
  slotTitle: "Primary" | "Secondary" | "Tertiary",
  input: UsagePacingInput,
  now: number,
): ProviderUsagePacing | undefined {
  const resolved = resolveSlotPace(
    providerId,
    slotTitle,
    {
      windowMinutes: input.windowMinutes,
      resetsAt: input.resetsAt,
      resetDescription: input.resetDescription,
    },
    now,
  );
  if (!resolved) {
    return undefined;
  }

  const pacing = calculateUsagePacing(
    { ...input, windowMinutes: resolved.windowMinutes },
    now,
    resolved.defaultWindowMinutes,
  );
  return pacing ? { ...pacing, context: resolved.context } : undefined;
}

type SlotTitle = "Primary" | "Secondary" | "Tertiary";

// Upstream MenuDescriptor.rateWindowLabels layers dynamic overrides on top of the
// static registry labels: factory (tertiary → 5-hour/Weekly/Monthly), grok (primary
// by window length), doubao (windowless requests), crof/amp/sub2api (secondary
// present), alibabatokenplan (5-hour / 7-day), codex (title follows windowMinutes).
function resolveSlotDisplayTitle(
  providerId: string,
  slotTitle: SlotTitle,
  options: {
    windowMinutes?: number;
    resetsAt?: string;
    resetDescription?: string;
    factoryHasTertiary: boolean;
    hasSecondary: boolean;
    now: number;
  },
): string {
  if (providerId === "factory" && options.factoryHasTertiary) {
    return slotTitle === "Primary" ? "5-hour" : slotTitle === "Secondary" ? "Weekly" : "Monthly";
  }

  if (providerId === "codex" && (slotTitle === "Primary" || slotTitle === "Secondary")) {
    if (options.windowMinutes === 5 * 60) {
      return "Session";
    }
    if (options.windowMinutes === 7 * 24 * 60) {
      return "Weekly";
    }
    if (options.windowMinutes === 30 * 24 * 60) {
      return "Monthly";
    }
  }

  // Deliberate widening vs upstream: options.resetsAt includes the payload-level
  // sessionResetsAt/resetsAt fallbacks, while GrokProviderDescriptor.displayLabel reads
  // only the primary window's own resetsAt. Real CLI payloads carry no top-level reset
  // fields, and the label should agree with whatever countdown the section renders.
  if (providerId === "grok" && slotTitle === "Primary") {
    const durationMs = grokWindowDurationMs(options.windowMinutes, options.resetsAt, options.now);
    const dynamicTitle = grokPrimaryDisplayTitle(durationMs);
    if (dynamicTitle) {
      return dynamicTitle;
    }
    // Untyped window with resetsAt is the weekly pool (displayLabel / #2929).
    if (options.windowMinutes === undefined && options.resetsAt) {
      return "Weekly";
    }
  }

  // Mirrors DoubaoProviderDescriptor.primaryLabel: pay-as-you-go Doubao accounts have no
  // 5h window — the payload carries a "requests"-style resetDescription instead.
  if (
    providerId === "doubao" &&
    slotTitle === "Primary" &&
    options.windowMinutes === undefined &&
    options.resetDescription?.toLowerCase().includes("request")
  ) {
    return "Requests";
  }

  if (providerId === "crof" && slotTitle === "Primary") {
    return options.hasSecondary ? "Requests" : "Credits";
  }

  if (providerId === "amp" && options.hasSecondary) {
    if (slotTitle === "Primary") {
      return "Other usage";
    }
    if (slotTitle === "Secondary") {
      return "Orb usage";
    }
  }

  if (providerId === "alibabatokenplan") {
    if (slotTitle === "Primary" && options.windowMinutes === 5 * 60) {
      return "5-hour";
    }
    if (slotTitle === "Secondary" && options.windowMinutes === 7 * 24 * 60) {
      return "7-day";
    }
  }

  if (providerId === "sub2api" && slotTitle === "Primary" && options.hasSecondary) {
    return "Daily quota";
  }

  return getProviderUsageSectionDisplayTitle(providerId, slotTitle);
}

// CodexConsumerProjection.weeklyCapsSession: weekly is the binding cap while remaining
// is 0 and the weekly reset is still in the future (or unknown).
function codexWeeklyCapsSession(
  weeklyRemainingPercent: number,
  weeklyResetsAt: string | undefined,
  now: number,
): boolean {
  if (weeklyRemainingPercent > 0) {
    return false;
  }

  if (!weeklyResetsAt) {
    return true;
  }

  const resetMs = Date.parse(weeklyResetsAt);
  if (Number.isNaN(resetMs)) {
    return true;
  }

  return resetMs > now;
}

// CodexConsumerProjection.bindingReset: when session still has headroom, retarget to
// weekly's reset; when both are exhausted, prefer the later of the two known resets.
function codexBindingResetsAt(
  sessionRemainingPercent: number,
  sessionResetsAt: string | undefined,
  weeklyResetsAt: string | undefined,
  now: number,
): string | undefined {
  const sessionResetMs = sessionResetsAt ? Date.parse(sessionResetsAt) : Number.NaN;
  const sessionResetFuture = !sessionResetsAt || Number.isNaN(sessionResetMs) ? true : sessionResetMs > now;
  const sessionIsExhausted = sessionRemainingPercent <= 0 && sessionResetFuture;

  if (!sessionIsExhausted) {
    return weeklyResetsAt;
  }

  if (!sessionResetsAt || !weeklyResetsAt) {
    return undefined;
  }

  const weeklyResetMs = Date.parse(weeklyResetsAt);
  if (Number.isNaN(sessionResetMs) || Number.isNaN(weeklyResetMs)) {
    return undefined;
  }

  return sessionResetMs > weeklyResetMs ? sessionResetsAt : weeklyResetsAt;
}

function applyCodexWeeklySessionCap(
  sections: ProviderSection[],
  resetsAtByTitle: Partial<Record<"Primary" | "Secondary", string | undefined>>,
  now: number,
): ProviderSection[] {
  const primaryIndex = sections.findIndex((section) => section.kind === "usage" && section.title === "Primary");
  const secondaryIndex = sections.findIndex((section) => section.kind === "usage" && section.title === "Secondary");
  if (primaryIndex < 0 || secondaryIndex < 0) {
    return sections;
  }

  const primary = sections[primaryIndex];
  const secondary = sections[secondaryIndex];
  if (primary.kind !== "usage" || secondary.kind !== "usage") {
    return sections;
  }

  const weeklyResetsAt = resetsAtByTitle.Secondary;
  if (!codexWeeklyCapsSession(secondary.remainingPercent, weeklyResetsAt, now)) {
    return sections;
  }

  const bindingResetsAt = codexBindingResetsAt(primary.remainingPercent, resetsAtByTitle.Primary, weeklyResetsAt, now);

  const next = sections.slice();
  next[primaryIndex] = {
    ...primary,
    remainingPercent: 0,
    resetsIn: bindingResetsAt ? formatCountdown(bindingResetsAt, now) : undefined,
    usagePacing: undefined,
  };
  return next;
}

function buildUsageSections(providerId: string, payload: RawProviderPayload, now = Date.now()): ProviderSection[] {
  const usage = toRecord(payload.usage);
  const sections: ProviderSection[] = [];
  const resetsAtByTitle: Partial<Record<"Primary" | "Secondary", string | undefined>> = {};
  const slotFallbacks = [
    {
      title: "Primary" as const,
      record: toRecord(usage?.primary),
      remainingPercent:
        toFiniteNumber(payload.sessionPercentLeft) ??
        normalizePercentFromFraction(toFiniteNumber(payload.remainingFraction) ?? Number.NaN) ??
        toFiniteNumber(payload.remainingPercent),
      resetTimestamp: toString(payload.sessionResetsAt) ?? toString(payload.resetsAt),
    },
    {
      title: "Secondary" as const,
      record: toRecord(usage?.secondary),
      remainingPercent: toFiniteNumber(payload.weeklyPercentLeft),
      resetTimestamp: toString(payload.weeklyResetsAt),
    },
    {
      title: "Tertiary" as const,
      record: toRecord(usage?.tertiary),
      remainingPercent: undefined,
      resetTimestamp: undefined,
    },
  ];
  // A present window is one that will render — upstream's `snapshot.* != nil` check.
  const factoryHasTertiary = toFiniteNumber(toRecord(usage?.tertiary)?.usedPercent) !== undefined;
  const hasSecondary = toFiniteNumber(toRecord(usage?.secondary)?.usedPercent) !== undefined;

  for (const slot of slotFallbacks) {
    const record = slot.record ?? {};
    const usedPercent = toFiniteNumber(record.usedPercent);
    const progressPercent =
      slot.remainingPercent ?? (usedPercent !== undefined ? Math.max(0, 100 - usedPercent) : undefined);
    if (progressPercent !== undefined) {
      const resolvedUsedPercent = usedPercent ?? Math.max(0, 100 - progressPercent);
      const resolvedResetsAt = toString(record.resetsAt) ?? slot.resetTimestamp;
      if (slot.title === "Primary" || slot.title === "Secondary") {
        resetsAtByTitle[slot.title] = resolvedResetsAt;
      }
      const usagePacing = resolvedResetsAt
        ? computeSlotUsagePacing(
            providerId,
            slot.title,
            {
              usedPercent: resolvedUsedPercent,
              remainingPercent: progressPercent,
              resetsAt: resolvedResetsAt,
              windowMinutes: toFiniteNumber(record.windowMinutes),
              resetDescription: toTrimmedString(record.resetDescription),
            },
            now,
          )
        : undefined;
      sections.push({
        kind: "usage",
        title: slot.title,
        displayTitle: resolveSlotDisplayTitle(providerId, slot.title, {
          windowMinutes: toFiniteNumber(record.windowMinutes),
          resetsAt: resolvedResetsAt,
          resetDescription: toTrimmedString(record.resetDescription),
          factoryHasTertiary,
          hasSecondary,
          now,
        }),
        remainingPercent: clampPercent(progressPercent),
        resetsIn: buildWindowReset(record, slot.resetTimestamp, now),
        usagePacing,
        nextRegenPercent: toFiniteNumber(record.nextRegenPercent),
      });
    }
  }

  // Raw path only (presentation meters never call this). Codex weekly-empty caps session.
  if (providerId === "codex") {
    return applyCodexWeeklySessionCap(sections, resetsAtByTitle, now);
  }

  return sections;
}

function buildExtraRateWindowSections(
  providerId: string,
  payload: RawProviderPayload,
  now = Date.now(),
): ProviderSection[] {
  const usage = toRecord(payload.usage);
  const extraRateWindows = Array.isArray(usage?.extraRateWindows) ? usage.extraRateWindows : [];
  const sections: ProviderSection[] = [];

  for (const entry of extraRateWindows) {
    const record = toRecord(entry);
    if (!record) {
      continue;
    }

    const title = toTrimmedString(record.title) ?? toTrimmedString(record.id);
    const window = toRecord(record.window);
    const usedPercent = toFiniteNumber(window?.usedPercent);
    if (!title || !window || usedPercent === undefined) {
      continue;
    }

    const remainingPercent = Math.max(0, 100 - usedPercent);
    const resetsAt = toString(window.resetsAt);
    const usagePacing = resetsAt
      ? computeExtraWindowUsagePacing(
          providerId,
          {
            usedPercent,
            remainingPercent,
            resetsAt,
            windowMinutes: toFiniteNumber(window.windowMinutes),
            resetDescription: toTrimmedString(window.resetDescription),
          },
          now,
        )
      : undefined;

    sections.push({
      kind: "supplementalUsage",
      title,
      remainingPercent: clampPercent(remainingPercent),
      resetsIn: buildWindowReset(window, undefined, now),
      usagePacing,
      nextRegenPercent: toFiniteNumber(window.nextRegenPercent),
    });
  }

  return sections;
}

// MenuCardView+ModelHelpers.antigravityMetrics: extras with this prefix are the real
// meters. Primary and Secondary are copies for the list adornment, so skip them on the card.
const ANTIGRAVITY_QUOTA_SUMMARY_WINDOW_ID_PREFIX = "antigravity-quota-summary-";

function hasAntigravityQuotaSummaryWindows(payload: RawProviderPayload): boolean {
  const extraRateWindows = toRecord(payload.usage)?.extraRateWindows;
  if (!Array.isArray(extraRateWindows)) {
    return false;
  }

  return extraRateWindows.some((entry) =>
    toTrimmedString(toRecord(entry)?.id)?.startsWith(ANTIGRAVITY_QUOTA_SUMMARY_WINDOW_ID_PREFIX),
  );
}

function hideAntigravityRepresentativeSlots(sections: ProviderSection[]): ProviderSection[] {
  return sections.map((section) => (section.kind === "usage" ? { ...section, includeInDetail: false } : section));
}

type PresentationMeterKind = "primary" | "secondary" | "tertiary" | "supplemental";

function toPresentationMeterKind(value: unknown): PresentationMeterKind | undefined {
  if (value === "primary" || value === "secondary" || value === "tertiary" || value === "supplemental") {
    return value;
  }

  return undefined;
}

function buildPresentationMeterSections(
  providerId: string,
  payload: RawProviderPayload,
  now = Date.now(),
): { schemaVersion: number; sections: ProviderSection[] } | undefined {
  const presentation = toRecord(payload.presentation);
  const schemaVersion = toFiniteNumber(presentation?.schemaVersion);
  if (schemaVersion !== 1 || !Array.isArray(presentation?.meters)) {
    return undefined;
  }

  const sections: ProviderSection[] = [];
  for (const entry of presentation.meters) {
    const meter = toRecord(entry);
    const kind = toPresentationMeterKind(meter?.kind);
    const label = toTrimmedString(meter?.label);
    if (!meter || !kind || !label) {
      continue;
    }

    const usedPercent = toFiniteNumber(meter.usedPercent);
    const reportedRemainingPercent = toFiniteNumber(meter.remainingPercent);
    const remainingPercent =
      reportedRemainingPercent ?? (usedPercent === undefined ? undefined : Math.max(0, 100 - usedPercent));
    if (remainingPercent === undefined) {
      continue;
    }

    const resetsAt = toString(meter.resetsAt);
    const resolvedUsedPercent = usedPercent ?? Math.max(0, 100 - remainingPercent);
    const windowMinutes = toFiniteNumber(meter.windowMinutes);
    const nextRegenPercent = toFiniteNumber(meter.nextRegenPercent);

    if (kind === "primary" || kind === "secondary" || kind === "tertiary") {
      const title = kind === "primary" ? "Primary" : kind === "secondary" ? "Secondary" : "Tertiary";
      const usagePacing = resetsAt
        ? computeSlotUsagePacing(
            providerId,
            title,
            {
              usedPercent: resolvedUsedPercent,
              remainingPercent,
              resetsAt,
              windowMinutes,
              resetDescription: toTrimmedString(meter.resetDescription),
            },
            now,
          )
        : undefined;
      sections.push({
        kind: "usage",
        title,
        displayTitle: label,
        remainingPercent: clampPercent(remainingPercent),
        resetsIn: resetsAt ? formatCountdown(resetsAt, now) : undefined,
        usagePacing,
        nextRegenPercent,
      });
      continue;
    }

    if (kind === "supplemental") {
      const usagePacing = resetsAt
        ? computeExtraWindowUsagePacing(
            providerId,
            {
              usedPercent: resolvedUsedPercent,
              remainingPercent,
              resetsAt,
              windowMinutes,
              resetDescription: toTrimmedString(meter.resetDescription),
            },
            now,
          )
        : undefined;
      sections.push({
        kind: "supplementalUsage",
        title: label,
        remainingPercent: clampPercent(remainingPercent),
        resetsIn: resetsAt ? formatCountdown(resetsAt, now) : undefined,
        usagePacing,
        nextRegenPercent,
      });
    }
  }

  return { schemaVersion, sections };
}

const SUPPLEMENTAL_USAGE_MAPPERS: Record<string, (record: RawProviderPayload, now: number) => ProviderSection[]> = {
  openRouterUsage: (record) => {
    const sections: ProviderSection[] = [];
    const usedPercent = toFiniteNumber(record.usedPercent);
    if (usedPercent !== undefined) {
      sections.push({
        kind: "supplementalUsage",
        title: "Credits used",
        remainingPercent: clampPercent(100 - usedPercent),
      });
    }

    const items: ProviderSectionItem[] = [];
    const balance = toFiniteNumber(record.balance);
    if (balance !== undefined) {
      items.push({ label: "Balance", value: formatCurrency(balance, "USD") });
    }

    const keyUsage = toFiniteNumber(record.keyUsage);
    const keyLimit = toFiniteNumber(record.keyLimit);
    if (keyUsage !== undefined && keyLimit !== undefined && keyLimit > 0) {
      items.push({
        label: "Key usage",
        value: `${formatCurrency(keyUsage, "USD")} / ${formatCurrency(keyLimit, "USD")}`,
      });
    }

    if (items.length > 0) {
      sections.push({ kind: "info", title: "OpenRouter", items });
    }

    return sections;
  },
};

function buildProviderSpecificUsageSections(payload: RawProviderPayload, now = Date.now()): ProviderSection[] {
  const usage = toRecord(payload.usage);
  if (!usage) {
    return [];
  }

  const sections: ProviderSection[] = [];
  for (const [fieldName, mapper] of Object.entries(SUPPLEMENTAL_USAGE_MAPPERS)) {
    const record = toRecord(usage[fieldName]);
    if (record) {
      sections.push(...mapper(record, now));
    }
  }

  return sections;
}

type CodexResetCredit = {
  expiresAt?: string;
  expiresAtMs?: number;
};

function normalizeCodexResetCredits(payload: RawProviderPayload, now = Date.now()): CodexResetCredit[] {
  const usage = toRecord(payload.usage);
  const codexResetCredits = toRecord(usage?.codexResetCredits);
  const credits = Array.isArray(codexResetCredits?.credits) ? codexResetCredits.credits : [];
  const availableCredits: CodexResetCredit[] = [];

  for (const credit of credits) {
    const record = toRecord(credit);
    if (!record || record.status !== "available") {
      continue;
    }

    const expiresAt = firstString(record.expires_at, record.expiresAt);
    if (!expiresAt) {
      availableCredits.push({});
      continue;
    }

    const expiresAtMs = Date.parse(expiresAt);
    if (Number.isNaN(expiresAtMs) || expiresAtMs <= now) {
      continue;
    }

    availableCredits.push({ expiresAt, expiresAtMs });
  }

  return availableCredits.sort((left, right) => {
    if (left.expiresAtMs === undefined && right.expiresAtMs === undefined) {
      return 0;
    }

    if (left.expiresAtMs === undefined) {
      return 1;
    }

    if (right.expiresAtMs === undefined) {
      return -1;
    }

    return left.expiresAtMs - right.expiresAtMs;
  });
}

function formatCodexResetCreditCount(count: number): string {
  return count === 1 ? "1 available" : `${count} available`;
}

function formatCodexResetCreditExpiry(credit: CodexResetCredit, now: number): string {
  return credit.expiresAt ? (formatCountdown(credit.expiresAt, now) ?? "No expiry") : "No expiry";
}

function buildCodexResetCreditSection(
  providerId: string,
  payload: RawProviderPayload,
  now = Date.now(),
): ProviderSection[] {
  if (providerId !== "codex") {
    return [];
  }

  const credits = normalizeCodexResetCredits(payload, now);
  if (credits.length === 0) {
    return [];
  }

  const items: ProviderSectionItem[] = [
    { label: "Available", value: formatCodexResetCreditCount(credits.length) },
    { label: "Next expiry", value: formatCodexResetCreditExpiry(credits[0], now) },
  ];

  if (credits.length > 1) {
    items.push({
      label: "Expiries",
      value: credits.map((credit) => formatCodexResetCreditExpiry(credit, now)).join(", "),
    });
  }

  return [{ kind: "info", title: "Limit Reset Credits", items }];
}

function buildSupplementalUsageSections(payload: RawProviderPayload, now = Date.now()): ProviderSection[] {
  const dashboard = toRecord(payload.openaiDashboard);
  const sections: ProviderSection[] = [];

  const codeReviewRemainingPercent = toFiniteNumber(dashboard?.codeReviewRemainingPercent);
  if (codeReviewRemainingPercent !== undefined) {
    const codeReviewLimit = toRecord(dashboard?.codeReviewLimit);
    sections.push({
      kind: "supplementalUsage",
      title: "Code review",
      remainingPercent: clampPercent(codeReviewRemainingPercent),
      resetsIn: codeReviewLimit ? buildWindowReset(codeReviewLimit, undefined, now) : undefined,
    });
  }

  return sections;
}

function extractAccountEmail(payload: RawProviderPayload): string | undefined {
  const usage = toRecord(payload.usage);
  const usageIdentity = toRecord(usage?.identity);
  const identity = toRecord(payload.identity);
  const account = toRecord(payload.account);

  return firstString(
    payload.accountEmail,
    identity?.accountEmail,
    usage?.accountEmail,
    usageIdentity?.accountEmail,
    account?.accountEmail,
    account?.email,
  );
}

function extractRawPlanText(providerId: string, payload: RawProviderPayload): string | undefined {
  const usage = toRecord(payload.usage);
  const usageIdentity = toRecord(usage?.identity);
  const identity = toRecord(payload.identity);
  const account = toRecord(payload.account);
  const dashboard = toRecord(payload.openaiDashboard);

  if (providerId === "claude") {
    const claudePlan = firstString(
      payload.plan,
      identity?.plan,
      usage?.plan,
      usageIdentity?.plan,
      account?.plan,
      payload.subscriptionType,
      identity?.subscriptionType,
      usage?.subscriptionType,
      usageIdentity?.subscriptionType,
      account?.subscriptionType,
      payload.rateLimitTier,
      identity?.rateLimitTier,
      usage?.rateLimitTier,
      usageIdentity?.rateLimitTier,
      account?.rateLimitTier,
    );
    if (claudePlan) {
      return claudePlan;
    }
  }

  return firstString(
    payload.loginMethod,
    identity?.loginMethod,
    usage?.loginMethod,
    usageIdentity?.loginMethod,
    account?.loginMethod,
    account?.plan,
    dashboard?.accountPlan,
  );
}

function formatSlugLabel(raw: string): string {
  const acronymMap = new Map<string, string>([
    ["api", "API"],
    ["cli", "CLI"],
    ["oauth", "OAuth"],
    ["sso", "SSO"],
    ["usd", "USD"],
    ["openai", "OpenAI"],
  ]);

  return raw
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => {
      const normalized = part.toLowerCase();
      const acronym = acronymMap.get(normalized);
      if (acronym) {
        return acronym;
      }

      return `${normalized[0]?.toUpperCase() ?? ""}${normalized.slice(1)}`;
    })
    .join(" ");
}

function extractKiloPass(rawPlanText: string): string | undefined {
  const parts = rawPlanText
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }

  const firstPart = parts[0];
  if (firstPart.toLowerCase().startsWith("auto top-up:")) {
    return undefined;
  }

  return firstPart;
}

function formatPlanText(providerId: string, payload: RawProviderPayload): string | undefined {
  const rawPlanText = extractRawPlanText(providerId, payload);
  if (!rawPlanText) {
    return undefined;
  }

  const providerScopedPlanText = providerId === "kilo" ? (extractKiloPass(rawPlanText) ?? rawPlanText) : rawPlanText;
  if (
    /^[a-z0-9_-]+$/i.test(providerScopedPlanText) &&
    providerScopedPlanText === providerScopedPlanText.toLowerCase()
  ) {
    return formatSlugLabel(providerScopedPlanText);
  }

  return providerScopedPlanText;
}

function collectFromArray(payload: unknown[]): ProviderCandidate[] {
  const candidates: ProviderCandidate[] = [];

  for (const entry of payload) {
    const record = toRecord(entry);
    if (!record) {
      continue;
    }

    candidates.push({ id: toString(record.provider) ?? toString(record.id), payload: record });
  }

  return candidates;
}

function collectCandidates(payload: unknown): ProviderCandidate[] {
  if (Array.isArray(payload)) {
    return collectFromArray(payload);
  }

  const record = toRecord(payload);
  if (!record) {
    return [];
  }

  const providers = record.providers;
  if (providers !== undefined) {
    return collectCandidates(providers);
  }

  const data = toRecord(record.data);
  if (data?.providers !== undefined) {
    return collectCandidates(data.providers);
  }

  return [{ id: toString(record.provider) ?? toString(record.id), payload: record }];
}

function getNestedErrorMessage(payload: RawProviderPayload): string | undefined {
  const error = payload.error;
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (!isRecord(error)) {
    return undefined;
  }

  return toString(error.message) ?? toString(error.detail);
}

// Pulls the `status` object out of a raw usage payload (from `usage --status`)
// for the matching provider and normalizes it. Kept separate from the usage
// sections so status never rides along in the provider-detail cache.
export function extractProviderStatus(payload: unknown, providerId: string): ProviderStatus | undefined {
  const candidates = collectCandidates(payload);
  // Prefer the exact provider; otherwise fall back only to the first candidate
  // that actually carries a status (mirroring extractProviderErrorMessage). A
  // blind `candidates[0]` would surface a neighbouring provider's status for the
  // requested one, while this still handles a single-provider payload keyed under
  // a different id.
  const candidate =
    candidates.find((entry) => entry.id === providerId) ??
    candidates.find((entry) => parseProviderStatus(entry.payload.status) !== undefined);
  const source = candidate?.payload ?? toRecord(payload);
  if (!source) {
    return undefined;
  }

  return parseProviderStatus(source.status);
}

export function extractProviderErrorMessage(payload: unknown, providerId: string): string | undefined {
  const candidates = collectCandidates(payload);
  const candidate =
    candidates.find((entry) => entry.id === providerId) ??
    candidates.find((entry) => getNestedErrorMessage(entry.payload) !== undefined);

  return candidate ? getNestedErrorMessage(candidate.payload) : undefined;
}

function normalizePayload(providerId: string, payload: RawProviderPayload, now = Date.now()): ProviderDetailData {
  const metadata = getProviderMetadata(providerId);
  const updatedAt = extractUpdatedAt(payload);
  const fetchedAt = new Date(now).toISOString();
  const accountEmail = extractAccountEmail(payload);
  const planText = formatPlanText(metadata.id, payload);
  const presentation = buildPresentationMeterSections(metadata.id, payload, now);
  const rawSections = presentation?.sections ?? [
    ...buildUsageSections(metadata.id, payload, now),
    ...buildExtraRateWindowSections(metadata.id, payload, now),
    ...buildSupplementalUsageSections(payload, now),
    ...buildProviderSpecificUsageSections(payload, now),
    ...buildCodexResetCreditSection(metadata.id, payload, now),
  ];
  const sections =
    presentation === undefined && metadata.id === "antigravity" && hasAntigravityQuotaSummaryWindows(payload)
      ? hideAntigravityRepresentativeSlots(rawSections)
      : rawSections;

  return {
    id: metadata.id,
    name: metadata.name,
    fetchedAt,
    updatedAt,
    accountEmail,
    planText,
    source: extractResolvedSource(payload),
    presentationSchemaVersion: presentation?.schemaVersion,
    sections,
  };
}

export function normalizeProviderDetailPayload(
  payload: unknown,
  providerId: string,
  now = Date.now(),
): ProviderDetailData {
  const candidates = collectCandidates(payload);
  const candidate = candidates.find((entry) => entry.id === providerId) ?? candidates[0];

  if (candidate) {
    return normalizePayload(providerId, candidate.payload, now);
  }

  const record = toRecord(payload);
  if (record) {
    return normalizePayload(providerId, record, now);
  }

  return normalizePayload(providerId, { provider: providerId }, now);
}
