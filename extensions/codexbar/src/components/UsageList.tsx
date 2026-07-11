import { ActionPanel, Icon, List } from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CommandErrorDetail } from "./CommandErrorDetail";
import { InstallHelpDetail } from "./InstallHelpDetail";
import { ManageProvidersAction } from "./ManageProvidersAction";
import { getProviderDetailHeaderTimestamp } from "./ProviderDetail";
import { ProviderListItem } from "./ProviderListItem";
import { useCodexBarAvailability } from "../hooks/useCodexBarAvailability";
import { useProviderDetails } from "../hooks/useProviderDetails";
import { useProviderStatuses } from "../hooks/useProviderStatuses";
import { useProviderDetailErrorToast } from "../hooks/useProviderDetailErrorToast";
import { useRelativeUpdateTime } from "../hooks/useRelativeUpdateTime";
import { useUsageOverview } from "../hooks/useUsageOverview";
import { useMoveProvider } from "../hooks/useMoveProvider";

export function UsageList() {
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const availability = useCodexBarAvailability();
  const binary = availability.availability?.status === "available" ? availability.availability.binary : undefined;
  const configuredProviders = useUsageOverview(binary);

  useEffect(() => {
    const providers = configuredProviders.providers;
    if (providers.length === 0) {
      if (selectedProviderId) setSelectedProviderId(undefined);
      return;
    }
    if (providers.some((p) => p.id === selectedProviderId)) return;
    setSelectedProviderId(providers[0].id);
  }, [configuredProviders.providers, selectedProviderId]);

  const selectedProvider = useMemo(
    () => configuredProviders.providers.find((provider) => provider.id === selectedProviderId),
    [configuredProviders.providers, selectedProviderId],
  );

  const providerDetails = useProviderDetails(binary, configuredProviders.providers, selectedProviderId);
  const { isLoading: isProviderDetailLoading, refreshProvider, results: providerDetailResults } = providerDetails;
  const statusProviderIds = useMemo(
    () => configuredProviders.providers.map((provider) => provider.id),
    [configuredProviders.providers],
  );
  const providerStatuses = useProviderStatuses(statusProviderIds);
  const selectedProviderDetail = selectedProviderId ? providerDetailResults[selectedProviderId] : undefined;
  const selectedProviderDetailHeaderTimestamp = getProviderDetailHeaderTimestamp(
    selectedProviderDetail?.detail,
    selectedProviderDetail?.cacheStatus,
  );
  const relativeTimeNow = useRelativeUpdateTime(
    selectedProviderDetailHeaderTimestamp,
    Boolean(selectedProviderId && selectedProviderDetailHeaderTimestamp && !selectedProviderDetail?.isLoading),
  );
  const refreshSelectedProvider = useCallback(() => {
    if (selectedProviderId) {
      refreshProvider(selectedProviderId, { force: true });
    }
  }, [refreshProvider, selectedProviderId]);

  const moveProvider = useMoveProvider(
    useCallback(
      (providerId: string) => {
        setSelectedProviderId(providerId);
        configuredProviders.revalidate();
      },
      [configuredProviders],
    ),
  );

  useProviderDetailErrorToast({
    error: selectedProviderDetail?.error,
    providerId: selectedProviderId,
    providerName: selectedProvider?.name,
    onRetry: refreshSelectedProvider,
  });

  if (availability.error) {
    return (
      <CommandErrorDetail
        title="Failed to Check CodexBar CLI"
        error={availability.error}
        onRetry={availability.revalidate}
      />
    );
  }

  if (availability.availability?.status === "unavailable") {
    return <InstallHelpDetail install={availability.availability.install} onRetry={availability.revalidate} />;
  }

  if (availability.availability?.status === "error") {
    return (
      <CommandErrorDetail
        title="CodexBar CLI Check Failed"
        error={availability.availability.error}
        onRetry={availability.revalidate}
      />
    );
  }

  if (configuredProviders.error) {
    return (
      <CommandErrorDetail
        title="Failed to Load CodexBar Config"
        error={configuredProviders.error}
        onRetry={configuredProviders.revalidate}
      />
    );
  }

  return (
    <List
      isLoading={availability.isLoading || configuredProviders.isLoading || isProviderDetailLoading}
      isShowingDetail
      searchBarPlaceholder="Filter providers"
      onSelectionChange={(newValue) => setSelectedProviderId(newValue ?? undefined)}
    >
      {configuredProviders.providers.length === 0 && !configuredProviders.isLoading ? (
        <List.EmptyView
          title="No Supported Providers"
          description="Enable a provider from Manage Providers, or in CodexBar, and reopen this command."
          icon={Icon.Circle}
          actions={
            binary ? (
              <ActionPanel>
                <ManageProvidersAction binary={binary} onProvidersChanged={configuredProviders.revalidate} />
              </ActionPanel>
            ) : undefined
          }
        />
      ) : null}
      {configuredProviders.providers.map((provider, index) => {
        const providerDetail = providerDetailResults[provider.id];

        return (
          <ProviderListItem
            key={provider.id}
            provider={provider}
            detail={providerDetail?.detail}
            detailError={providerDetail?.error}
            isDetailLoading={providerDetail?.isLoading ?? false}
            detailCacheStatus={providerDetail?.cacheStatus}
            status={providerStatuses[provider.id]}
            isSelected={provider.id === selectedProviderId}
            relativeTimeNow={provider.id === selectedProviderId ? relativeTimeNow : undefined}
            binary={binary}
            onProvidersChanged={configuredProviders.revalidate}
            onRefresh={() => refreshProvider(provider.id, { force: true })}
            onMoveUp={index > 0 ? () => void moveProvider(provider.id, "up") : undefined}
            onMoveDown={
              index < configuredProviders.providers.length - 1
                ? () => void moveProvider(provider.id, "down")
                : undefined
            }
          />
        );
      })}
    </List>
  );
}
