import { Action, Icon } from "@raycast/api";
import type { ResolvedCodexBarBinary } from "../lib/codexbar";
import { ManageProviders } from "./ManageProviders";

type ManageProvidersActionProps = {
  binary?: ResolvedCodexBarBinary;
  onProvidersChanged?: () => void;
};

// Shared entry point into the Manage Providers subview, used from both provider
// rows and the empty view so a user who has disabled every provider can still
// get back to enabling one. Renders nothing when the CLI binary is unavailable.
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
