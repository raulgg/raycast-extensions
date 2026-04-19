import { environment, List } from "@raycast/api";
import { formatRelativeUpdateTime } from "../lib/presentation";
import { buildProviderErrorMarkdown } from "../lib/presentation";
import type { ProviderDetailCacheStatus } from "../hooks/useProviderDetails";
import { getHidePersonalInfoPreference } from "../preferences";
import { buildProviderDetailMarkdown, buildProviderLoadingMarkdown } from "../providers/markdown";
import type { ConfiguredProvider, ProviderDetailData } from "../providers/types";

type ProviderDetailProps = {
  provider: ConfiguredProvider;
  detail?: ProviderDetailData;
  error?: Error;
  isLoading: boolean;
  cacheStatus?: ProviderDetailCacheStatus;
  relativeTimeNow?: number;
};

export function ProviderDetail({
  provider,
  detail,
  error,
  isLoading,
  cacheStatus,
  relativeTimeNow,
}: ProviderDetailProps) {
  const hidePersonalInfo = getHidePersonalInfoPreference();
  const detailMarkdown = detail
    ? buildSafeProviderDetailMarkdown(detail, isLoading, cacheStatus, relativeTimeNow)
    : undefined;
  const markdown = detailMarkdown
    ? detailMarkdown
    : error
      ? buildProviderErrorMarkdown(provider.name, error, environment.appearance)
      : isLoading
        ? buildProviderLoadingMarkdown(provider, environment.appearance)
        : "No data available";

  return <List.Item.Detail isLoading={isLoading} markdown={markdown} />;

  function buildSafeProviderDetailMarkdown(
    detail: ProviderDetailData,
    isLoading: boolean,
    cacheStatus?: ProviderDetailCacheStatus,
    now?: number,
  ): string | undefined {
    try {
      const detailForRender = hidePersonalInfo ? { ...detail, accountEmail: undefined } : detail;
      return buildProviderDetailMarkdown(detailForRender, environment.appearance, {
        subtitle: getHeaderSubtitle(detail, isLoading, cacheStatus, now),
        now,
      }).trim();
    } catch (error) {
      if (isLegacySectionShapeError(error)) {
        return detail.markdown.trim() || undefined;
      }

      throw error;
    }
  }
}

function getHeaderSubtitle(
  detail: ProviderDetailData,
  isLoading: boolean,
  cacheStatus?: ProviderDetailCacheStatus,
  now?: number,
): string | undefined {
  if (cacheStatus === "stale") {
    if (isLoading) {
      return "Updating... | ⚠︎ Stale data";
    }

    const relativeUpdatedAt = formatRelativeUpdateTime(detail.updatedAt, { now });
    return relativeUpdatedAt ? `Updated ${relativeUpdatedAt} | ⚠︎ Stale data` : "⚠︎ Stale data";
  }

  return isLoading ? "Updating..." : undefined;
}

function isLegacySectionShapeError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Unsupported metric section kind: undefined");
}
