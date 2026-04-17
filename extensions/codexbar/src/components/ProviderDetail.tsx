import { environment, List } from "@raycast/api";
import { buildProviderErrorMarkdown } from "../lib/presentation";
import { getHidePersonalInfoPreference } from "../preferences";
import { buildProviderDetailMarkdown, buildProviderLoadingMarkdown } from "../providers/markdown";
import type { ConfiguredProvider, ProviderDetailData } from "../providers/types";

type ProviderDetailProps = {
  provider: ConfiguredProvider;
  detail?: ProviderDetailData;
  error?: Error;
  isLoading: boolean;
  relativeTimeNow?: number;
};

export function ProviderDetail({ provider, detail, error, isLoading, relativeTimeNow }: ProviderDetailProps) {
  const hidePersonalInfo = getHidePersonalInfoPreference();
  const detailMarkdown = detail ? buildSafeProviderDetailMarkdown(detail, isLoading) : undefined;
  const markdown = error
    ? buildProviderErrorMarkdown(provider.name, error, environment.appearance)
    : detailMarkdown
      ? detailMarkdown
      : isLoading
        ? buildProviderLoadingMarkdown(provider, environment.appearance)
        : "No data available";

  return <List.Item.Detail isLoading={isLoading} markdown={markdown} />;

  function buildSafeProviderDetailMarkdown(detail: ProviderDetailData, isLoading: boolean): string | undefined {
    try {
      const detailForRender = hidePersonalInfo ? { ...detail, accountEmail: undefined } : detail;
      return buildProviderDetailMarkdown(detailForRender, environment.appearance, {
        subtitle: isLoading ? "Updating..." : undefined,
        now: relativeTimeNow,
      }).trim();
    } catch (error) {
      if (isLegacySectionShapeError(error)) {
        return detail.markdown.trim() || undefined;
      }

      throw error;
    }
  }
}

function isLegacySectionShapeError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Unsupported metric section kind: undefined");
}
