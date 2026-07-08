import { Action, Icon } from "@raycast/api";
import type { ResolvedCodexBarBinary } from "../lib/codexbar";
import { ManageProviders } from "./ManageProviders";

type ManageProvidersActionProps = {
  binary?: ResolvedCodexBarBinary;
  onProvidersChanged?: () => void;
};

export function ManageProvidersAction({ binary, onProvidersChanged }: ManageProvidersActionProps) {
  if (!binary) {
    return null;
  }

  return (
    <Action.Push
      title="Manage Providers"
      icon={Icon.Cog}
      shortcut={{ modifiers: ["cmd", "shift"], key: "m" }}
      target={<ManageProviders binary={binary} onProvidersChanged={onProvidersChanged} />}
    />
  );
}
