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

export type ProviderSection = {
  title: string;
  displayTitle?: string;
  items: ProviderSectionItem[];
  progressPercent?: number;
};

export type ProviderDetailData = {
  id: string;
  name: string;
  raw: RawProviderPayload;
  fetchedAt: string;
  updatedAt?: string;
  sections: ProviderSection[];
  markdown: string;
};
