import { Action, ActionPanel, Icon, List } from "@raycast/api";
import type { ProviderDetailCacheStatus } from "../hooks/useProviderDetails";
import type { ConfiguredProvider, ProviderDetailData, ProviderUsageSection } from "../providers/types";
import { ProviderDetail } from "./ProviderDetail";

type ProviderListItemProps = {
  provider: ConfiguredProvider;
  detail?: ProviderDetailData;
  detailError?: Error;
  isDetailLoading: boolean;
  detailCacheStatus?: ProviderDetailCacheStatus;
  isSelected: boolean;
  relativeTimeNow?: number;
  onRefresh: () => void;
};

export function ProviderListItem({
  provider,
  detail,
  detailError,
  isDetailLoading,
  detailCacheStatus,
  isSelected,
  relativeTimeNow,
  onRefresh,
}: ProviderListItemProps) {
  const fetchCommand = `codexbar usage --provider ${provider.id}`;

  return (
    <List.Item
      id={provider.id}
      title={provider.name}
      keywords={provider.keywords}
      icon={provider.icon}
      accessories={buildProviderListItemAccessories(detail, detailError, isDetailLoading)}
      detail={
        <ProviderDetail
          provider={provider}
          detail={detail}
          error={detailError}
          isLoading={isDetailLoading}
          cacheStatus={detailCacheStatus}
          relativeTimeNow={isSelected ? relativeTimeNow : undefined}
        />
      }
      actions={
        <ActionPanel>
          <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={onRefresh} />
          <Action.CopyToClipboard title="Copy CLI Command" content={fetchCommand} icon={Icon.Clipboard} />
        </ActionPanel>
      }
    />
  );
}

export function buildProviderListItemAccessories(
  detail: ProviderDetailData | undefined,
  error: Error | undefined,
  isLoading: boolean,
): List.Item.Accessory[] | undefined {
  if (isLoading && !detail && !error) {
    return [
      {
        icon: Icon.Hourglass,
        tooltip: "Loading usage",
      },
    ];
  }

  if (error && !detail) {
    return [
      {
        icon: Icon.Warning,
        tooltip: formatProviderDetailErrorTooltip(),
      },
    ];
  }

  const primaryUsage = getPrimaryUsageSection(detail);
  if (!primaryUsage) {
    return undefined;
  }

  const remainingPercent = Math.round(primaryUsage.remainingPercent);

  return [
    {
      icon: Icon.Gauge,
      text: `${remainingPercent}%`,
      tooltip: `${primaryUsage.displayTitle} remaining: ${remainingPercent}%`,
    },
  ];
}

export function formatProviderDetailErrorTooltip(): string {
  return "Failed to load usage";
}

function getPrimaryUsageSection(detail: ProviderDetailData | undefined): ProviderUsageSection | undefined {
  return detail?.sections.find(
    (section): section is ProviderUsageSection => section.kind === "usage" && section.title === "Primary",
  );
}
