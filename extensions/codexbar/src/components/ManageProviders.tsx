import { Action, ActionPanel, Color, Icon, List, showToast, Toast } from "@raycast/api";
import { useCallback, useRef, useState } from "react";
import { useAvailableProviders } from "../hooks/useAvailableProviders";
import {
  CodexBarCliError,
  moveConfiguredProviderInConfig,
  setProviderEnabled,
  type ProviderMoveDirection,
  type ResolvedCodexBarBinary,
} from "../lib/codexbar";
import type { AvailableProvider } from "../providers/types";

const NOT_IN_OVERVIEW_HINT = "Not shown in the Raycast Usage Overview yet";

type ManageProvidersProps = {
  binary: ResolvedCodexBarBinary;
  // Called after a successful toggle so the Usage Overview re-reads the config
  // and reflects the newly enabled/disabled provider when the user returns.
  onProvidersChanged?: () => void;
};

export function ManageProviders({ binary, onProvidersChanged }: ManageProvidersProps) {
  const available = useAvailableProviders(binary);
  const [pendingProviderId, setPendingProviderId] = useState<string>();
  // Each toggle/reorder is an independent read-modify-write of the shared config
  // (CLI subprocess or direct file write). Serialize them with this guard so an
  // overlapping mutation can't read a stale config and clobber the other's
  // update. The in-flight row's Hourglass accessory signals the busy state.
  const isMutatingRef = useRef(false);

  const toggleProvider = useCallback(
    async (provider: AvailableProvider) => {
      if (isMutatingRef.current) {
        return;
      }
      isMutatingRef.current = true;

      const nextEnabled = !provider.enabled;
      setPendingProviderId(provider.id);
      try {
        await setProviderEnabled(binary, provider.cliProvider, nextEnabled);
        await showToast({
          style: Toast.Style.Success,
          title: nextEnabled ? `Enabled ${provider.name}` : `Disabled ${provider.name}`,
          message: nextEnabled && !provider.supported ? NOT_IN_OVERVIEW_HINT : undefined,
        });
        available.revalidate();
        onProvidersChanged?.();
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to Update Provider",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setPendingProviderId(undefined);
        isMutatingRef.current = false;
      }
    },
    [available, binary, onProvidersChanged],
  );

  // Reorder within the enabled providers. Writes the reordering straight to the
  // shared config (per ADR-0001), moving the entry among the enabled subset
  // without touching disabled entries. Only enabled providers are
  // reorderable — order is the Usage Overview display order, and disabled
  // providers are not rendered there.
  const moveProvider = useCallback(
    async (providerId: string, direction: ProviderMoveDirection) => {
      if (isMutatingRef.current) {
        return;
      }
      isMutatingRef.current = true;

      try {
        const didMove = await moveConfiguredProviderInConfig(providerId, direction);
        if (!didMove) {
          return;
        }

        available.revalidate();
        onProvidersChanged?.();
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to Reorder Providers",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        isMutatingRef.current = false;
      }
    },
    [available, onProvidersChanged],
  );

  // A failed roster load usually means the installed CLI is too old to manage
  // providers, but it can also be a launch failure or a transient timeout — the
  // error's kind tells them apart, so we don't misreport a timeout as an old CLI.
  if (available.error) {
    const { title, description } = describeManageProvidersError(available.error);
    return (
      <List navigationTitle="Manage Providers">
        <List.EmptyView icon={Icon.Warning} title={title} description={description} />
      </List>
    );
  }

  const enabledProviders = available.providers.filter((provider) => provider.enabled);
  const disabledProviders = available.providers.filter((provider) => !provider.enabled);

  // Only registry-supported providers are reorderable, and the move writes the
  // config array (which excludes unsupported entries). Gate Move Up/Down on the
  // provider's index within this supported subset — in config order, thanks to
  // listAvailableProviders — so the UI and the write agree on adjacency.
  const reorderableProviders = enabledProviders.filter((provider) => provider.supported);
  const reorderIndexById = new Map(reorderableProviders.map((provider, index) => [provider.id, index]));

  return (
    <List isLoading={available.isLoading} navigationTitle="Manage Providers" searchBarPlaceholder="Filter providers">
      <List.Section title="Enabled" subtitle={enabledProviders.length ? `${enabledProviders.length}` : undefined}>
        {enabledProviders.map((provider) => {
          const reorderIndex = reorderIndexById.get(provider.id);
          const canMoveUp = reorderIndex !== undefined && reorderIndex > 0;
          const canMoveDown = reorderIndex !== undefined && reorderIndex < reorderableProviders.length - 1;

          return (
            <ProviderToggleItem
              key={provider.id}
              provider={provider}
              isPending={pendingProviderId === provider.id}
              onToggle={() => void toggleProvider(provider)}
              onMoveUp={canMoveUp ? () => void moveProvider(provider.id, "up") : undefined}
              onMoveDown={canMoveDown ? () => void moveProvider(provider.id, "down") : undefined}
            />
          );
        })}
      </List.Section>
      <List.Section title="Disabled" subtitle={disabledProviders.length ? `${disabledProviders.length}` : undefined}>
        {disabledProviders.map((provider) => (
          <ProviderToggleItem
            key={provider.id}
            provider={provider}
            isPending={pendingProviderId === provider.id}
            onToggle={() => void toggleProvider(provider)}
          />
        ))}
      </List.Section>
    </List>
  );
}

type ProviderToggleItemProps = {
  provider: AvailableProvider;
  isPending: boolean;
  onToggle: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
};

function ProviderToggleItem({ provider, isPending, onToggle, onMoveUp, onMoveDown }: ProviderToggleItemProps) {
  return (
    <List.Item
      icon={provider.icon}
      title={provider.name}
      keywords={[provider.id, provider.cliProvider]}
      accessories={buildToggleAccessories(provider, isPending)}
      actions={
        <ActionPanel>
          <Action
            title={provider.enabled ? "Disable Provider" : "Enable Provider"}
            icon={provider.enabled ? Icon.XMarkCircle : Icon.CheckCircle}
            onAction={onToggle}
          />
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
        </ActionPanel>
      }
    />
  );
}

// Maps a roster-load failure to user-facing copy. Only "unavailable" (CLI can't
// launch) and "timeout" get their own message; every other failure is treated as
// "the installed CLI is too old to know `config providers`", which is the common
// case for this capability probe.
function describeManageProvidersError(error: Error): { title: string; description: string } {
  const kind = error instanceof CodexBarCliError ? error.kind : undefined;

  if (kind === "unavailable") {
    return {
      title: "CodexBar CLI Not Found",
      description: "Unable to launch the codexbar CLI. Make sure CodexBar is installed and try again.",
    };
  }

  if (kind === "timeout") {
    return {
      title: "CodexBar Timed Out",
      description: "Loading providers timed out. Try reopening this command.",
    };
  }

  return {
    title: "Managing Providers Needs a Newer CodexBar CLI",
    description: "The installed codexbar CLI does not support the config commands. Update CodexBar and try again.",
  };
}

function buildToggleAccessories(provider: AvailableProvider, isPending: boolean): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];

  // The Usage Overview only renders registry-supported providers, so enabling an
  // unsupported one otherwise looks like a no-op. Flag it here so the dead-end is
  // visible rather than silent.
  if (!provider.supported) {
    accessories.push({ icon: Icon.Info, tooltip: NOT_IN_OVERVIEW_HINT });
  }

  accessories.push(buildToggleStateAccessory(provider, isPending));
  return accessories;
}

function buildToggleStateAccessory(provider: AvailableProvider, isPending: boolean): List.Item.Accessory {
  if (isPending) {
    return { icon: Icon.Hourglass, tooltip: "Updating…" };
  }

  if (provider.enabled) {
    return { icon: { source: Icon.CheckCircle, tintColor: Color.Green }, tooltip: "Enabled" };
  }

  return { icon: Icon.Circle, tooltip: "Disabled" };
}
