import { Icon, List } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { CommandErrorDetail } from "./CommandErrorDetail";
import { InstallHelpDetail } from "./InstallHelpDetail";
import { ProviderListItem } from "./ProviderListItem";
import { useCodexBarAvailability } from "../hooks/useCodexBarAvailability";
import { useProviderDetail } from "../hooks/useProviderDetail";
import { useProviderDetailErrorToast } from "../hooks/useProviderDetailErrorToast";
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

  const providerDetail = useProviderDetail(binary, selectedProviderId);

  useProviderDetailErrorToast({
    error: providerDetail.error,
    providerId: selectedProviderId,
    providerName: selectedProvider?.name,
    onRetry: providerDetail.revalidate,
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
      isLoading={availability.isLoading || configuredProviders.isLoading}
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
      {configuredProviders.providers.map((provider) => (
        <ProviderListItem
          key={provider.id}
          provider={provider}
          detail={provider.id === selectedProviderId ? providerDetail.detail : undefined}
          detailError={provider.id === selectedProviderId ? providerDetail.error : undefined}
          isDetailLoading={provider.id === selectedProviderId ? providerDetail.isLoading : false}
          isSelected={provider.id === selectedProviderId}
          onRefresh={providerDetail.revalidate}
        />
      ))}
    </List>
  );
}
