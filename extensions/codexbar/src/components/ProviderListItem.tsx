import { Action, ActionPanel, Icon, List } from "@raycast/api";
import type { ProviderDetailCacheStatus } from "../hooks/useProviderDetails";
import type { ConfiguredProvider, ProviderDetailData, ProviderUsageSection } from "../providers/types";
import { buildTwoBarAccessoryIcon } from "../lib/twoBarAccessoryIcon";
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
  onMoveUp?: () => void;
  onMoveDown?: () => void;
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
  onMoveUp,
  onMoveDown,
}: ProviderListItemProps) {
  const fetchCommand = `codexbar usage --provider ${provider.id}`;

  return (
    <List.Item
      id={provider.id}
      title={provider.name}
      keywords={provider.keywords}
      icon={provider.icon}
      accessories={buildProviderListItemAccessories(provider.id, detail, detailError, isDetailLoading)}
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
          {onMoveUp ? (
            <Action
              title="Move Up"
              icon={Icon.ArrowUp}
              shortcut={{ modifiers: ["cmd", "opt"], key: "arrowUp" }}
              onAction={onMoveUp}
            />
          ) : null}
          {onMoveDown ? (
            <Action
              title="Move Down"
              icon={Icon.ArrowDown}
              shortcut={{ modifiers: ["cmd", "opt"], key: "arrowDown" }}
              onAction={onMoveDown}
            />
          ) : null}
          <Action.CopyToClipboard
            title="Copy CLI Command"
            content={fetchCommand}
            icon={Icon.Clipboard}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
        </ActionPanel>
      }
    />
  );
}

export function buildProviderListItemAccessories(
  providerId: string,
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

  const secondaryUsage = getUsageSection(detail, "Secondary");
  const primaryRemainingPercent = Math.round(primaryUsage.remainingPercent);
  const secondaryRemainingPercent = secondaryUsage ? Math.round(secondaryUsage.remainingPercent) : undefined;

  return [
    {
      icon: buildTwoBarAccessoryIcon(providerId, primaryRemainingPercent, secondaryRemainingPercent),
      text:
        secondaryRemainingPercent === undefined
          ? `${primaryRemainingPercent}%`
          : `${primaryRemainingPercent}% • ${secondaryRemainingPercent}%`,
      tooltip:
        secondaryUsage === undefined
          ? `${primaryUsage.displayTitle}: ${primaryRemainingPercent}% remaining`
          : `${primaryUsage.displayTitle}: ${primaryRemainingPercent}% remaining • ${secondaryUsage.displayTitle}: ${secondaryRemainingPercent}% remaining`,
    },
  ];
}

export function formatProviderDetailErrorTooltip(): string {
  return "Failed to load usage";
}

function getPrimaryUsageSection(detail: ProviderDetailData | undefined): ProviderUsageSection | undefined {
  return getUsageSection(detail, "Primary");
}

function getUsageSection(
  detail: ProviderDetailData | undefined,
  title: ProviderUsageSection["title"],
): ProviderUsageSection | undefined {
  return detail?.sections.find(
    (section): section is ProviderUsageSection => section.kind === "usage" && section.title === title,
  );
}
