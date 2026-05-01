import { environment, List } from "@raycast/api";
import { buildProviderErrorMarkdown, formatRelativeUpdateTime } from "../lib/presentation";
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
    ? buildProviderDetailMarkdown(
        hidePersonalInfo ? { ...detail, accountEmail: undefined } : detail,
        environment.appearance,
        {
          subtitle: getHeaderSubtitle(detail, isLoading, cacheStatus, relativeTimeNow),
          now: relativeTimeNow,
        },
      ).trim()
    : undefined;
  const markdown =
    detailMarkdown ??
    (error
      ? buildProviderErrorMarkdown(provider.name, error, environment.appearance)
      : isLoading
        ? buildProviderLoadingMarkdown(provider, environment.appearance)
        : "No data available");

  return <List.Item.Detail isLoading={isLoading} markdown={markdown} />;
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

    const relativeUpdatedAt = formatRelativeUpdateTime(getProviderDetailHeaderTimestamp(detail, cacheStatus), { now });
    return relativeUpdatedAt ? `Updated ${relativeUpdatedAt} | ⚠︎ Stale data` : "⚠︎ Stale data";
  }

  return isLoading ? "Updating..." : undefined;
}

export function getProviderDetailHeaderTimestamp(
  detail: Pick<ProviderDetailData, "fetchedAt" | "updatedAt"> | undefined,
  cacheStatus?: ProviderDetailCacheStatus,
): string | undefined {
  if (!detail) {
    return undefined;
  }

  return cacheStatus === "stale" ? detail.fetchedAt : detail.updatedAt;
}
