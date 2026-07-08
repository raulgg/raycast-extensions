import { Action, Icon } from "@raycast/api";
import type { ReactNode } from "react";

// The Move Up / Move Down action pair, shared by the Usage Overview rows and the
// Manage Providers list so both keep the same titles and shortcuts. Returned as a
// plain element array (not a component) so it inlines into the ActionPanel and
// keeps the surrounding action order stable.
export function moveProviderActions(onMoveUp?: () => void, onMoveDown?: () => void): ReactNode[] {
  return [
    onMoveUp ? (
      <Action
        key="move-up"
        // eslint-disable-next-line @raycast/prefer-title-case
        title="Move Up"
        icon={Icon.ArrowUp}
        shortcut={{ modifiers: ["cmd", "opt"], key: "arrowUp" }}
        onAction={onMoveUp}
      />
    ) : null,
    onMoveDown ? (
      <Action
        key="move-down"
        title="Move Down"
        icon={Icon.ArrowDown}
        shortcut={{ modifiers: ["cmd", "opt"], key: "arrowDown" }}
        onAction={onMoveDown}
      />
    ) : null,
  ];
}
