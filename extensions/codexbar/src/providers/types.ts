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
};

export type ProviderUsagePacingStage =
  | "onTrack"
  | "slightlyOver"
  | "over"
  | "farOver"
  | "slightlyUnder"
  | "under"
  | "farUnder";

export type ProviderUsagePacing = {
  stage: ProviderUsagePacingStage;
  usedVsIdealDeltaPercent: number;
  idealUsedPercentByNow: number;
  actualUsedPercent: number;
  runOutEtaSeconds?: number;
  lastsUntilReset: boolean;
  computedAt: string;
};

export type ProviderUsageSectionTitle = "Primary" | "Secondary" | "Tertiary";

export type ProviderUsageSection = {
  kind: "usage";
  title: ProviderUsageSectionTitle;
  displayTitle: string;
  remainingPercent: number;
  resetsIn?: string;
  usagePacing?: ProviderUsagePacing;
};

export type ProviderSupplementalUsageSection = {
  kind: "supplementalUsage";
  title: string;
  remainingPercent: number;
  resetsIn?: string;
  usagePacing?: ProviderUsagePacing;
};

export type ProviderCreditsSection = {
  kind: "credits";
  title: "Credits";
  remaining: string;
  remainingPercent: number;
  scaleLabel: string;
};

export type ProviderCostSection = {
  kind: "providerCost";
  title: "Extra usage" | "Quota usage";
  usedPercent: number;
  spendLine: string;
};

export type ProviderInfoSection = {
  kind: "info";
  title: string;
  items: ProviderSectionItem[];
};

export type ProviderSection =
  | ProviderUsageSection
  | ProviderSupplementalUsageSection
  | ProviderCreditsSection
  | ProviderCostSection
  | ProviderInfoSection;

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
