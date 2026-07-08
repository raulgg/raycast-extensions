import { Action, ActionPanel, Icon, List } from "@raycast/api";
import type { ProviderDetailCacheStatus } from "../hooks/useProviderDetails";
import type { ConfiguredProvider, ProviderDetailData, ProviderStatus, ProviderUsageSection } from "../providers/types";
import { buildTwoBarAccessoryIcon } from "../lib/twoBarAccessoryIcon";
import { getProviderMetadata, resolveDashboardUrl } from "../providers/registry";
import type { ResolvedCodexBarBinary } from "../lib/codexbar";
import { ManageProvidersAction } from "./ManageProvidersAction";
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
  binary?: ResolvedCodexBarBinary;
  onRefresh: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onProvidersChanged?: () => void;
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
  binary,
  onRefresh,
  onMoveUp,
  onMoveDown,
  onProvidersChanged,
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
          <ManageProvidersAction binary={binary} onProvidersChanged={onProvidersChanged} />
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

// Incident status is intentionally absent here: it renders as a bottom footer
// in the detail panel, so the list accessories stay usage-only.
export function buildProviderListItemAccessories(
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
