import type { ImageLike } from "@raycast/api";

export type RawProviderPayload = Record<string, unknown>;

export type ConfiguredProvider = {
  id: string;
  name: string;
  icon: ImageLike;
  keywords?: string[];
};

export type ProviderSectionItem = {
  label: string;
  value: string;
};

export type ProviderUsagePaceStage =
  | "onTrack"
  | "slightlyAhead"
  | "ahead"
  | "farAhead"
  | "slightlyBehind"
  | "behind"
  | "farBehind";

export type ProviderUsagePace = {
  stage: ProviderUsagePaceStage;
  deltaPercent: number;
  expectedUsedPercent: number;
  actualUsedPercent: number;
  etaSeconds?: number;
  willLastToReset: boolean;
  runOutProbability?: number;
  computedAt: string;
};

export type ProviderUsageSectionTitle = "Primary" | "Secondary" | "Tertiary";

export type ProviderUsageSection = {
  kind: "usage";
  title: ProviderUsageSectionTitle;
  displayTitle: string;
  remainingPercent: number;
  resetsIn?: string;
  pace?: ProviderUsagePace;
};

export type ProviderSupplementalUsageSection = {
  kind: "supplementalUsage";
  title: string;
  remainingPercent: number;
  resetsIn?: string;
  pace?: ProviderUsagePace;
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
