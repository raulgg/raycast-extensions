import { Icon, List } from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CommandErrorDetail } from "./CommandErrorDetail";
import { InstallHelpDetail } from "./InstallHelpDetail";
import { ProviderListItem } from "./ProviderListItem";
import { useCodexBarAvailability } from "../hooks/useCodexBarAvailability";
import { useProviderDetails } from "../hooks/useProviderDetails";
import { useProviderDetailErrorToast } from "../hooks/useProviderDetailErrorToast";
import { useRelativeUpdateTime } from "../hooks/useRelativeUpdateTime";
import { useUsageOverview } from "../hooks/useUsageOverview";

export function UsageList() {
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const availability = useCodexBarAvailability();
  const binary = availability.availability?.status === "available" ? availability.availability.binary : undefined;
  const configuredProviders = useUsageOverview(binary);

  useEffect(() => {
    if (configuredProviders.providers.length === 0) {
      if (selectedProviderId) {
        setSelectedProviderId(undefined);
      }
      return;
    }

    const currentSelectionStillExists = configuredProviders.providers.some(
      (provider) => provider.id === selectedProviderId,
    );
    if (currentSelectionStillExists) {
      return;
    }

    setSelectedProviderId(configuredProviders.providers[0].id);
  }, [configuredProviders.providers, selectedProviderId]);

  const selectedProvider = useMemo(
    () => configuredProviders.providers.find((provider) => provider.id === selectedProviderId),
    [configuredProviders.providers, selectedProviderId],
  );

  const providerDetails = useProviderDetails(binary, configuredProviders.providers, selectedProviderId);
  const { isLoading: isProviderDetailLoading, refreshProvider, results: providerDetailResults } = providerDetails;
  const selectedProviderDetail = selectedProviderId ? providerDetailResults[selectedProviderId] : undefined;
  const relativeTimeNow = useRelativeUpdateTime(
    selectedProviderDetail?.detail?.updatedAt,
    Boolean(
      selectedProviderId &&
      selectedProviderDetail?.detail?.updatedAt &&
      !selectedProviderDetail?.isLoading &&
      !selectedProviderDetail?.error,
    ),
  );
  const refreshSelectedProvider = useCallback(() => {
    if (selectedProviderId) {
      refreshProvider(selectedProviderId);
    }
  }, [refreshProvider, selectedProviderId]);

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
          description="Enable a supported provider in CodexBar and reopen this command."
          icon={Icon.Circle}
        />
      ) : null}
      {configuredProviders.providers.map((provider) => {
        const providerDetail = providerDetailResults[provider.id];

        return (
          <ProviderListItem
            key={provider.id}
            provider={provider}
            detail={providerDetail?.detail}
            detailError={providerDetail?.error}
            isDetailLoading={providerDetail?.isLoading ?? false}
            isSelected={provider.id === selectedProviderId}
            relativeTimeNow={provider.id === selectedProviderId ? relativeTimeNow : undefined}
            onRefresh={() => refreshProvider(provider.id)}
          />
        );
      })}
    </List>
  );
}
