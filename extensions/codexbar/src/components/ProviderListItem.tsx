import { Action, ActionPanel, Icon, List } from "@raycast/api";
import type { ConfiguredProvider, ProviderDetailData } from "../providers/types";
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
