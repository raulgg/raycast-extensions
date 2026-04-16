import { Action, ActionPanel, Icon, List } from "@raycast/api";
import type { ConfiguredProvider, ProviderDetailData, ProviderUsageSection } from "../providers/types";
import { ProviderDetail } from "./ProviderDetail";

type ProviderListItemProps = {
  provider: ConfiguredProvider;
  detail?: ProviderDetailData;
  detailError?: Error;
  isDetailLoading: boolean;
  isSelected: boolean;
  onRefresh: () => void;
};

export function ProviderListItem({ provider, detail, detailError, isDetailLoading, onRefresh }: ProviderListItemProps) {
  const fetchCommand = `codexbar usage --provider ${provider.id}`;

  return (
    <List.Item
      id={provider.id}
      title={provider.name}
      keywords={provider.keywords}
      icon={provider.icon}
      accessories={buildProviderListItemAccessories(detail, detailError, isDetailLoading)}
      detail={<ProviderDetail provider={provider} detail={detail} error={detailError} isLoading={isDetailLoading} />}
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

  if (error) {
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
