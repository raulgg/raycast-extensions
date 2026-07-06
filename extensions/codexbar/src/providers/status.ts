import type { ProviderStatus, ProviderStatusIndicator } from "./types";

// Cached status is only shown while recent; incident data is slow-moving, so a
// 30-minute TTL keeps a badge visible between background refreshes without ever
// surfacing a long-stale incident once the Raycast background refresh stops.
export const PROVIDER_STATUS_TTL_MS = 30 * 60 * 1000;

// Upstream indicator labels, mirroring ProviderStatusIndicator.label in
// CLIPayloads.swift so the extension reads the same wording as the app.
export const PROVIDER_STATUS_LABELS: Record<ProviderStatusIndicator, string> = {
  none: "Operational",
  minor: "Partial outage",
  major: "Major outage",
  critical: "Critical issue",
  maintenance: "Maintenance",
  unknown: "Status unknown",
};

const PROVIDER_STATUS_INDICATORS = new Set<ProviderStatusIndicator>([
  "none",
  "minor",
  "major",
  "critical",
  "maintenance",
  "unknown",
]);

// Any indicator the CLI (or a future statuspage schema) reports that we do not
// recognize collapses to "unknown", mirroring upstream StatusFetcher's
// `?? .unknown` fallback. "unknown" renders nothing, so this fails safe.
export function normalizeProviderStatusIndicator(value: unknown): ProviderStatusIndicator {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (PROVIDER_STATUS_INDICATORS.has(normalized as ProviderStatusIndicator)) {
      return normalized as ProviderStatusIndicator;
    }
  }

  return "unknown";
}

export function parseProviderStatus(value: unknown): ProviderStatus | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (record.indicator === undefined) {
    return undefined;
  }

  return {
    indicator: normalizeProviderStatusIndicator(record.indicator),
    description: toTrimmedString(record.description),
    updatedAt: toTrimmedString(record.updatedAt),
    url: toTrimmedString(record.url),
  };
}

export function getProviderStatusLabel(indicator: ProviderStatusIndicator): string {
  return PROVIDER_STATUS_LABELS[indicator];
}

// "none" (operational) is the default, not news; "unknown" carries no signal.
// Neither renders a badge anywhere.
export function isRenderableProviderStatusIndicator(indicator: ProviderStatusIndicator): boolean {
  return indicator !== "none" && indicator !== "unknown";
}

// Upstream tooltip/detail format: `{label} – {description}` (en dash), matching
// ProviderStatusPayload.descriptionSuffix in CLIPayloads.swift.
export function formatProviderStatusSummary(status: ProviderStatus): string {
  const label = getProviderStatusLabel(status.indicator);
  return status.description ? `${label} – ${status.description}` : label;
}

export function isProviderStatusFresh(fetchedAt: string, now = Date.now()): boolean {
  const fetchedAtMs = Date.parse(fetchedAt);
  return !Number.isNaN(fetchedAtMs) && now - fetchedAtMs <= PROVIDER_STATUS_TTL_MS;
}

function toTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
