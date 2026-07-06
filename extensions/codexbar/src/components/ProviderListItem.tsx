import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import type { ProviderDetailCacheStatus } from "../hooks/useProviderDetails";
import type { ConfiguredProvider, ProviderDetailData, ProviderStatus, ProviderUsageSection } from "../providers/types";
import { formatProviderStatusSummary, isRenderableProviderStatusIndicator } from "../providers/status";
import { buildTwoBarAccessoryIcon } from "../lib/twoBarAccessoryIcon";
import { getProviderMetadata, resolveDashboardUrl } from "../providers/registry";
import { ProviderDetail } from "./ProviderDetail";

type ProviderListItemProps = {
  provider: ConfiguredProvider;
  detail?: ProviderDetailData;
  detailError?: Error;
  isDetailLoading: boolean;
  detailCacheStatus?: ProviderDetailCacheStatus;
  status?: ProviderStatus;
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
  status,
  isSelected,
  relativeTimeNow,
  onRefresh,
  onMoveUp,
  onMoveDown,
}: ProviderListItemProps) {
  const fetchCommand = `codexbar usage --provider ${provider.id}`;
  const statusPageUrl = getProviderMetadata(provider.id).statusPageUrl ?? status?.url;
  // When detail (and thus planText) hasn't loaded yet, this falls back to the
  // plain dashboardUrl; for Claude subscription plans it resolves to claude.ai.
  const dashboardUrl = resolveDashboardUrl(provider.id, detail?.planText);

  return (
    <List.Item
      id={provider.id}
      title={provider.name}
      keywords={provider.keywords}
      icon={provider.icon}
      accessories={buildProviderListItemAccessories(
        provider.id,
        detail,
        detailError,
        isDetailLoading,
        detailCacheStatus,
        status,
      )}
      detail={
        <ProviderDetail
          provider={provider}
          detail={detail}
          error={detailError}
          isLoading={isDetailLoading}
          cacheStatus={detailCacheStatus}
          status={status}
          relativeTimeNow={isSelected ? relativeTimeNow : undefined}
        />
      }
      actions={
        <ActionPanel>
          <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={onRefresh} />
          {dashboardUrl ? (
            <Action.OpenInBrowser
              title="Open Usage Dashboard"
              icon={Icon.BarChart}
              url={dashboardUrl}
              shortcut={{ modifiers: ["cmd"], key: "o" }}
            />
          ) : null}
          {statusPageUrl ? (
            <Action.OpenInBrowser
              title="Open Status Page"
              icon={Icon.Globe}
              url={statusPageUrl}
              shortcut={{ modifiers: ["cmd", "shift"], key: "o" }}
            />
          ) : null}
          {onMoveUp ? (
            <Action
              // eslint-disable-next-line @raycast/prefer-title-case
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
  cacheStatus?: ProviderDetailCacheStatus,
  status?: ProviderStatus,
): List.Item.Accessory[] | undefined {
  const usageAccessories = buildProviderUsageAccessories(providerId, detail, error, isLoading, cacheStatus);
  const statusAccessory = buildProviderStatusAccessory(status);
  if (!statusAccessory) {
    return usageAccessories;
  }

  // The status badge is additive and precedes the usage accessories; it never
  // displaces the existing error/loading/stale accessories.
  return usageAccessories ? [statusAccessory, ...usageAccessories] : [statusAccessory];
}

export function buildProviderStatusAccessory(status?: ProviderStatus): List.Item.Accessory | undefined {
  if (!status || !isRenderableProviderStatusIndicator(status.indicator)) {
    return undefined;
  }

  const { icon, tintColor } = getProviderStatusIconStyle(status);
  return {
    icon: { source: icon, tintColor },
    tooltip: formatProviderStatusSummary(status),
  };
}

function getProviderStatusIconStyle(status: ProviderStatus): { icon: Icon; tintColor: Color } {
  switch (status.indicator) {
    case "minor":
      return { icon: Icon.Warning, tintColor: Color.Yellow };
    case "major":
      return { icon: Icon.Warning, tintColor: Color.Red };
    case "critical":
      return { icon: Icon.XMarkCircle, tintColor: Color.Red };
    case "maintenance":
      return { icon: Icon.Hammer, tintColor: Color.SecondaryText };
    default:
      return { icon: Icon.Warning, tintColor: Color.SecondaryText };
  }
}

function buildProviderUsageAccessories(
  providerId: string,
  detail: ProviderDetailData | undefined,
  error: Error | undefined,
  isLoading: boolean,
  cacheStatus?: ProviderDetailCacheStatus,
): List.Item.Accessory[] | undefined {
  if (cacheStatus === "stale" && detail) {
    if (isLoading) {
      return [
        {
          icon: Icon.Hourglass,
          tooltip: "Loading usage",
        },
      ];
    }

    return [
      {
        icon: Icon.Warning,
        tooltip: formatProviderDetailStaleTooltip(),
      },
    ];
  }

  const primaryUsage = getPrimaryUsageSection(detail);
  if (primaryUsage) {
    const secondaryUsage = getUsageSection(detail, "Secondary");
    const primaryRemainingPercent = Math.round(primaryUsage.remainingPercent);
    const secondaryRemainingPercent = secondaryUsage ? Math.round(secondaryUsage.remainingPercent) : undefined;
    const text =
      secondaryRemainingPercent === undefined
        ? `${primaryRemainingPercent}%`
        : `${primaryRemainingPercent}% • ${secondaryRemainingPercent}%`;
    const tooltip =
      secondaryUsage === undefined
        ? `${primaryUsage.displayTitle}: ${primaryRemainingPercent}% remaining`
        : `${primaryUsage.displayTitle}: ${primaryRemainingPercent}% remaining • ${secondaryUsage.displayTitle}: ${secondaryRemainingPercent}% remaining`;

    return [
      {
        text,
        tooltip,
      },
      {
        icon: buildTwoBarAccessoryIcon(providerId, primaryRemainingPercent, secondaryRemainingPercent),
        tooltip,
      },
    ];
  }

  if (isLoading) {
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

  return undefined;
}

export function formatProviderDetailErrorTooltip(): string {
  return "Failed to load usage";
}

export function formatProviderDetailStaleTooltip(): string {
  return "Stale usage data";
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
