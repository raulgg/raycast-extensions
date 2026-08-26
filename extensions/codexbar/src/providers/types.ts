import type { Image } from "@raycast/api";

export type RawProviderPayload = Record<string, unknown>;

export type ProviderSourceMode = "auto" | "web" | "cli" | "oauth" | "api";
export type ProviderInteractionMode = "background" | "user";

export type ConfiguredProvider = {
  id: string;
  name: string;
  icon: Image.ImageLike;
  keywords?: string[];
  source?: ProviderSourceMode;
};

// A Provider the installed CodexBar CLI knows about and can toggle on/off, as
// reported by `codexbar config providers`. The full roster from which
// ConfiguredProviders (enabled === true) are drawn. `id` is the alias-resolved
// canonical id used for registry lookups; `cliProvider` is the raw id the CLI
// reported, which is what enable/disable commands are addressed to. `supported`
// is true when the extension registry recognizes the provider — only supported
// providers render in the Usage Overview and are reorderable there.
export type AvailableProvider = {
  id: string;
  cliProvider: string;
  name: string;
  icon: Image.ImageLike;
  enabled: boolean;
  supported: boolean;
};

export type ProviderSectionItem = {
  label: string;
  value: string;
  personal?: boolean;
};

export type ProviderUsagePacingStage =
  "onTrack" | "slightlyOver" | "over" | "farOver" | "slightlyUnder" | "under" | "farUnder";

// Selects the ETA phrasing, mirroring upstream UsagePaceText.DetailContext:
// the session (primary) window says "Projected empty in …"; every other
// window says "Runs out in …".
export type ProviderUsagePacingContext = "session" | "window";

export type ProviderUsagePacing = {
  stage: ProviderUsagePacingStage;
  usedVsIdealDeltaPercent: number;
  idealUsedPercentByNow: number;
  actualUsedPercent: number;
  runOutEtaSeconds?: number;
  lastsUntilReset: boolean;
  computedAt: string;
  context?: ProviderUsagePacingContext;
};

// Provider incident status, mirroring the CodexBar CLI's `status` payload
// (ProviderStatusPayload in CLIPayloads.swift). Sourced only from the CLI's
// `usage --status` flag, never fetched by this extension directly.
export type ProviderStatusIndicator = "none" | "minor" | "major" | "critical" | "maintenance" | "unknown";

export type ProviderStatus = {
  indicator: ProviderStatusIndicator;
  description?: string;
  updatedAt?: string;
  url?: string;
};

export type ProviderUsageSectionTitle = "Primary" | "Secondary" | "Tertiary";

export type ProviderUsageSection = {
  kind: "usage";
  title: ProviderUsageSectionTitle;
  displayTitle: string;
  remainingPercent: number;
  resetsIn?: string;
  usagePacing?: ProviderUsagePacing;
  nextRegenPercent?: number;
  includeInDetail?: boolean;
};

export type ProviderSupplementalUsageSection = {
  kind: "supplementalUsage";
  title: string;
  remainingPercent: number;
  resetsIn?: string;
  usagePacing?: ProviderUsagePacing;
  nextRegenPercent?: number;
};

export type ProviderInfoSection = {
  kind: "info";
  title: string;
  items: ProviderSectionItem[];
};

export type ProviderSection = ProviderUsageSection | ProviderSupplementalUsageSection | ProviderInfoSection;

export type ProviderDetailData = {
  id: string;
  name: string;
  fetchedAt: string;
  updatedAt?: string;
  accountEmail?: string;
  planText?: string;
  source?: string;
  requestedSource?: ProviderSourceMode;
  presentationSchemaVersion?: number;
  sections: ProviderSection[];
};
