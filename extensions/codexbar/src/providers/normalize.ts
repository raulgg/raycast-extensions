import { calculateWeeklyUsagePacing } from "./usagePacing";
import { getProviderMetadata, getProviderUsageSectionDisplayTitle, type ProviderUsagePacingSlot } from "./registry";
import type { ProviderDetailData, ProviderInfoSection, ProviderSection, RawProviderPayload } from "./types";
import { formatLocalDateTime } from "../lib/presentation";
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

function matchesUsagePacingSlot(
  title: "Primary" | "Secondary" | "Tertiary",
  usagePacingSlot?: ProviderUsagePacingSlot,
): boolean {
  return title.toLowerCase() === usagePacingSlot;
}

function buildUsageSections(providerId: string, payload: RawProviderPayload, now = Date.now()): ProviderSection[] {
  const metadata = getProviderMetadata(providerId);
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
      const usagePacing =
        matchesUsagePacingSlot(slot.title, metadata.usagePacingSlot) && resolvedResetsAt
          ? calculateWeeklyUsagePacing(
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
      });
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

function buildCreditsSection(payload: RawProviderPayload): ProviderSection | undefined {
  const credits = toRecord(payload.credits);
  const remaining = toFiniteNumber(credits?.remaining);
  if (remaining === undefined) {
    return undefined;
  }

  const fullScaleCredits = 1000;
  return {
    kind: "credits",
    title: "Credits",
    remaining: formatNumber(remaining),
    remainingPercent: clampPercent((remaining / fullScaleCredits) * 100),
    scaleLabel: "1K tokens",
  };
}

function buildProviderCostSection(payload: RawProviderPayload): ProviderSection | undefined {
  const usage = toRecord(payload.usage);
  const providerCost = toRecord(usage?.providerCost);
  const used = toFiniteNumber(providerCost?.used);
  const limit = toFiniteNumber(providerCost?.limit);
  const currencyCode = toString(providerCost?.currencyCode);

  if (used === undefined || limit === undefined || limit <= 0 || !currencyCode) {
    return undefined;
  }

  if (currencyCode === "Quota") {
    return {
      kind: "providerCost",
      title: "Quota usage",
      usedPercent: clampPercent((used / limit) * 100),
      spendLine: `${toString(providerCost?.period) ?? "This month"}: ${formatNumber(used)} / ${formatNumber(limit)}`,
    };
  }

  return {
    kind: "providerCost",
    title: "Extra usage",
    usedPercent: clampPercent((used / limit) * 100),
    spendLine: `${toString(providerCost?.period) ?? "This month"}: ${formatCurrency(used, currencyCode)} / ${formatCurrency(limit, currencyCode)}`,
  };
}

function buildUpdatedSection(updatedAt?: string): ProviderInfoSection | undefined {
  const formattedDate = formatLocalDateTime(updatedAt);
  if (!formattedDate) {
    return undefined;
  }

  return {
    kind: "info",
    title: "General",
    items: [{ label: "Last Updated", value: formattedDate }],
  };
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
  const sections = [...buildUsageSections(metadata.id, payload, now), ...buildSupplementalUsageSections(payload, now)];
  const creditsSection = buildCreditsSection(payload);
  const providerCostSection = buildProviderCostSection(payload);
  const updatedSection = buildUpdatedSection(updatedAt);

  if (creditsSection) {
    sections.push(creditsSection);
  }

  if (providerCostSection) {
    sections.push(providerCostSection);
  }

  if (updatedSection) {
    sections.push(updatedSection);
  }

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
