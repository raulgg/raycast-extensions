import { Action, ActionPanel, Icon, List } from "@raycast/api";
import type { ProviderDetailCacheStatus } from "../lib/providerDetailCache";
import type { ConfiguredProvider, ProviderDetailData, ProviderStatus, ProviderUsageSection } from "../providers/types";
import { formatPercentRemaining } from "../lib/presentation";
import { buildTwoBarAccessoryIcon } from "../lib/twoBarAccessoryIcon";
import { getProviderMetadata, resolveDashboardUrl } from "../providers/registry";
import type { ResolvedCodexBarBinary } from "../lib/codexbar";
import { ManageProvidersAction } from "./ManageProvidersAction";
import { moveProviderActions } from "./moveProviderActions";
import { ProviderDetail } from "./ProviderDetail";
import { CODEXBAR_DISABLE_KEYCHAIN_ACCESS_ENV, type KeychainAccessPolicy } from "../lib/keychainAccessPolicy";

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
  const fetchCommand = buildProviderFetchCommand(provider.id, binary?.keychainAccessPolicy ?? "default");
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
          {moveProviderActions(onMoveUp, onMoveDown)}
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

export function buildProviderFetchCommand(providerId: string, keychainAccessPolicy: KeychainAccessPolicy): string {
  const command = `codexbar usage --provider ${providerId}`;
  return keychainAccessPolicy === "disabled" ? `${CODEXBAR_DISABLE_KEYCHAIN_ACCESS_ENV}=1 ${command}` : command;
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
    return isLoading
      ? [{ icon: Icon.Hourglass, tooltip: "Loading usage" }]
      : [{ icon: Icon.Warning, tooltip: formatProviderDetailStaleTooltip() }];
  }

  const primaryUsage = getUsageSection(detail, "Primary");
  const secondaryUsage = getUsageSection(detail, "Secondary");
  const leadingUsage = primaryUsage ?? secondaryUsage;
  if (leadingUsage) {
    const trailingUsage = primaryUsage ? secondaryUsage : undefined;
    const leadingRemainingText = formatPercentRemaining(leadingUsage.remainingPercent);
    const trailingRemainingText = trailingUsage ? formatPercentRemaining(trailingUsage.remainingPercent) : undefined;
    const text =
      trailingRemainingText === undefined ? leadingRemainingText : `${leadingRemainingText} • ${trailingRemainingText}`;
    const tooltip =
      trailingUsage === undefined
        ? `${leadingUsage.displayTitle}: ${leadingRemainingText} remaining`
        : `${leadingUsage.displayTitle}: ${leadingRemainingText} remaining • ${trailingUsage.displayTitle}: ${trailingRemainingText} remaining`;

    return [
      {
        text,
        tooltip,
      },
      {
        icon: buildTwoBarAccessoryIcon(providerId, leadingUsage.remainingPercent, trailingUsage?.remainingPercent),
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

function getUsageSection(
  detail: ProviderDetailData | undefined,
  title: ProviderUsageSection["title"],
): ProviderUsageSection | undefined {
  return detail?.sections.find(
    (section): section is ProviderUsageSection => section.kind === "usage" && section.title === title,
  );
}
