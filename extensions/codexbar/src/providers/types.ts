import type { Image } from "@raycast/api";

export type RawProviderPayload = Record<string, unknown>;

export type ConfiguredProvider = {
  id: string;
  name: string;
  icon: Image.ImageLike;
  keywords?: string[];
};

export type ProviderSectionItem = {
  label: string;
  value: string;
  personal?: boolean;
};

export type ProviderUsagePacingStage =
  | "onTrack"
  | "slightlyOver"
  | "over"
  | "farOver"
  | "slightlyUnder"
  | "under"
  | "farUnder";

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

export type ProviderUsageSectionTitle = "Primary" | "Secondary" | "Tertiary";

export type ProviderUsageSection = {
  kind: "usage";
  title: ProviderUsageSectionTitle;
  displayTitle: string;
  remainingPercent: number;
  resetsIn?: string;
  usagePacing?: ProviderUsagePacing;
  nextRegenPercent?: number;
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
  raw: RawProviderPayload;
  fetchedAt: string;
  updatedAt?: string;
  accountEmail?: string;
  planText?: string;
  sections: ProviderSection[];
  markdown: string;
};
