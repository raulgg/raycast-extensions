import { calculateUsagePacing } from "./usagePacing";
import { getProviderMetadata, getProviderUsageSectionDisplayTitle } from "./registry";
import { parseProviderStatus } from "./status";
import type {
  ProviderDetailData,
  ProviderSection,
  ProviderSectionItem,
  ProviderStatus,
  ProviderUsagePacing,
  RawProviderPayload,
} from "./types";
import { buildProviderDetailMarkdown } from "./markdown";

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
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizePercentFromFraction(value: number): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  if (value >= 0 && value <= 1) {
    return Math.round(value * 100);
  }

  if (value >= 0 && value <= 100) {
    return Math.round(value);
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

// Default window durations used only when a payload window omits an explicit
// `windowMinutes`: session windows run on a 5h cadence, weekly on the 7d cadence.
const SESSION_PACE_DEFAULT_WINDOW_MINUTES = 300;
const WEEKLY_PACE_DEFAULT_WINDOW_MINUTES = 10_080;

// Session (primary) pace is a hand-maintained whitelist, mirroring upstream
// UsagePaceText.sessionPace(provider:): only codex, claude, and ollama get a
// marker on the session bar. codex/claude fall back to the 300-min default when
// the payload omits windowMinutes; ollama only paces when windowMinutes is
// explicit. It is a rule, not registry data — no property of the payload tells
// you a provider qualifies.
const SESSION_PACE_PROVIDER_IDS = new Set(["codex", "claude", "ollama"]);
const SESSION_PACE_EXPLICIT_WINDOW_PROVIDER_IDS = new Set(["ollama"]);

type UsagePacingInput = {
  usedPercent: number;
  remainingPercent: number;
  resetsAt: string;
  windowMinutes?: number;
};

function computeSessionUsagePacing(
  providerId: string,
  input: UsagePacingInput,
  now: number,
): ProviderUsagePacing | undefined {
  if (!SESSION_PACE_PROVIDER_IDS.has(providerId)) {
    return undefined;
  }

  if (SESSION_PACE_EXPLICIT_WINDOW_PROVIDER_IDS.has(providerId) && input.windowMinutes === undefined) {
    return undefined;
  }

  const pacing = calculateUsagePacing(input, now, SESSION_PACE_DEFAULT_WINDOW_MINUTES);
  return pacing ? { ...pacing, context: "session" } : undefined;
}

// Weekly/other windows (secondary, tertiary, extra rate windows) pace whenever
// they carry an explicit windowMinutes, mirroring upstream UsageStore.weeklyPace.
// The 10080-min fallback is only allowed for the codex secondary window — using
// it everywhere would fabricate a weekly pace for non-weekly windows (e.g.
// Factory monthly with only resetsAt).
function computeWeeklyUsagePacing(
  input: UsagePacingInput,
  now: number,
  allowDefaultWindowFallback: boolean,
): ProviderUsagePacing | undefined {
  if (input.windowMinutes === undefined && !allowDefaultWindowFallback) {
    return undefined;
  }

  const pacing = calculateUsagePacing(input, now, WEEKLY_PACE_DEFAULT_WINDOW_MINUTES);
  return pacing ? { ...pacing, context: "window" } : undefined;
}

function computeSlotUsagePacing(
  providerId: string,
  slotTitle: "Primary" | "Secondary" | "Tertiary",
  input: UsagePacingInput,
  now: number,
): ProviderUsagePacing | undefined {
  if (slotTitle === "Primary") {
    return computeSessionUsagePacing(providerId, input, now);
  }

  const allowDefaultWindowFallback = providerId === "codex" && slotTitle === "Secondary";
  return computeWeeklyUsagePacing(input, now, allowDefaultWindowFallback);
}

function buildUsageSections(providerId: string, payload: RawProviderPayload, now = Date.now()): ProviderSection[] {
  const usage = toRecord(payload.usage);
  const sections: ProviderSection[] = [];
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

  for (const slot of slotFallbacks) {
    const record = slot.record ?? {};
    const usedPercent = toFiniteNumber(record.usedPercent);
    const progressPercent =
      slot.remainingPercent ?? (usedPercent !== undefined ? Math.max(0, Math.round(100 - usedPercent)) : undefined);
    if (progressPercent !== undefined) {
      const resolvedUsedPercent = usedPercent ?? Math.max(0, 100 - progressPercent);
      const resolvedResetsAt = toString(record.resetsAt) ?? slot.resetTimestamp;
      const usagePacing = resolvedResetsAt
        ? computeSlotUsagePacing(
            providerId,
            slot.title,
            {
              usedPercent: resolvedUsedPercent,
              remainingPercent: progressPercent,
              resetsAt: resolvedResetsAt,
              windowMinutes: toFiniteNumber(record.windowMinutes),
            },
            now,
          )
        : undefined;
      sections.push({
        kind: "usage",
        title: slot.title,
        displayTitle: getProviderUsageSectionDisplayTitle(providerId, slot.title),
        remainingPercent: clampPercent(progressPercent),
        resetsIn: buildWindowReset(record, slot.resetTimestamp, now),
        usagePacing,
        nextRegenPercent: toFiniteNumber(record.nextRegenPercent),
      });
    }
  }

  return sections;
}

function buildExtraRateWindowSections(payload: RawProviderPayload, now = Date.now()): ProviderSection[] {
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
    // Named extra windows pace through the same generic weekly rule: only when
    // the payload carries an explicit windowMinutes (no default fallback).
    const usagePacing = resetsAt
      ? computeWeeklyUsagePacing(
          {
            usedPercent,
            remainingPercent,
            resetsAt,
            windowMinutes: toFiniteNumber(window.windowMinutes),
          },
          now,
          false,
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

function extractRawPlanText(payload: RawProviderPayload): string | undefined {
  const usage = toRecord(payload.usage);
  const usageIdentity = toRecord(usage?.identity);
  const identity = toRecord(payload.identity);
  const account = toRecord(payload.account);
  const dashboard = toRecord(payload.openaiDashboard);

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
  const rawPlanText = extractRawPlanText(payload);
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
  const sections = [
    ...buildUsageSections(metadata.id, payload, now),
    ...buildExtraRateWindowSections(payload, now),
    ...buildSupplementalUsageSections(payload, now),
    ...buildProviderSpecificUsageSections(payload, now),
  ];

  const detail = {
    id: metadata.id,
    name: metadata.name,
    raw: payload,
    fetchedAt,
    updatedAt,
    accountEmail,
    planText,
    sections,
  };

  return {
    ...detail,
    markdown: buildProviderDetailMarkdown(detail, undefined, { now }),
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
