import { getProviderMetadata, getProviderUsageSectionDisplayTitle } from "./registry";
import type { ProviderDetailData, ProviderSection, ProviderSectionItem, RawProviderPayload } from "./types";
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

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
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

function buildWindowItems(
  window: RawProviderPayload,
  fallbackRemainingPercent?: number,
  fallbackResetTimestamp?: string,
  now?: number,
): ProviderSectionItem[] {
  const items: ProviderSectionItem[] = [];
  const usedPercent = toFiniteNumber(window.usedPercent);
  const remainingPercent =
    usedPercent !== undefined ? Math.max(0, Math.round(100 - usedPercent)) : fallbackRemainingPercent;

  if (remainingPercent !== undefined) {
    items.push({ label: "Remaining", value: formatPercent(remainingPercent) });
  }

  const resetsAt = toString(window.resetsAt) ?? fallbackResetTimestamp;
  if (resetsAt) {
    const countdown = formatCountdown(resetsAt, now);
    if (countdown) {
      items.push({ label: "Resets In", value: countdown });
    }
  }

  return items;
}

function buildUsageSections(providerId: string, payload: RawProviderPayload, now = Date.now()): ProviderSection[] {
  const usage = toRecord(payload.usage);
  const sections: ProviderSection[] = [];
  const slotFallbacks = [
    {
      title: "Primary",
      record: toRecord(usage?.primary),
      remainingPercent:
        toFiniteNumber(payload.sessionPercentLeft) ??
        normalizePercentFromFraction(toFiniteNumber(payload.remainingFraction) ?? Number.NaN) ??
        toFiniteNumber(payload.remainingPercent),
      resetTimestamp: toString(payload.sessionResetsAt) ?? toString(payload.resetsAt),
    },
    {
      title: "Secondary",
      record: toRecord(usage?.secondary),
      remainingPercent: toFiniteNumber(payload.weeklyPercentLeft),
      resetTimestamp: toString(payload.weeklyResetsAt),
    },
    {
      title: "Tertiary",
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
    const items = buildWindowItems(record, slot.remainingPercent, slot.resetTimestamp, now);
    if (items.length > 0) {
      sections.push({
        title: slot.title,
        displayTitle: getProviderUsageSectionDisplayTitle(providerId, slot.title),
        items,
        progressPercent,
      });
    }
  }

  return sections;
}

function buildCreditsSection(payload: RawProviderPayload): ProviderSection | undefined {
  const credits = toRecord(payload.credits);
  const dashboard = toRecord(payload.openaiDashboard);
  const items: ProviderSectionItem[] = [];

  const remaining = toFiniteNumber(credits?.remaining);
  if (remaining !== undefined) {
    items.push({ label: "Remaining", value: formatNumber(remaining) });
  }

  const codeReviewRemainingPercent = toFiniteNumber(dashboard?.codeReviewRemainingPercent);
  if (codeReviewRemainingPercent !== undefined) {
    items.push({
      label: "Code Review Remaining",
      value: formatPercent(codeReviewRemainingPercent),
    });
  }

  const bonusCredits = toFiniteNumber(payload.bonusCreditsRemaining);
  if (bonusCredits !== undefined) {
    items.push({ label: "Bonus Credits", value: formatNumber(bonusCredits) });
  }

  return items.length > 0 ? { title: "Credits", items } : undefined;
}

function buildUpdatedSection(updatedAt?: string): ProviderSection | undefined {
  const formattedDate = formatLocalDateTime(updatedAt);
  if (!formattedDate) {
    return undefined;
  }

  return {
    title: "General",
    items: [{ label: "Last Updated", value: formattedDate }],
  };
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
  const sections = [...buildUsageSections(metadata.id, payload, now)];
  const creditsSection = buildCreditsSection(payload);
  const updatedSection = buildUpdatedSection(updatedAt);

  if (creditsSection) {
    sections.push(creditsSection);
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
    sections,
  };

  return {
    ...detail,
    markdown: buildProviderDetailMarkdown(detail),
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
