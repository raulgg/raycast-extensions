import { Action, Icon } from "@raycast/api";
import type { ReactNode } from "react";

// Shared Move Up / Move Down actions (array so they inline into ActionPanel in stable order).
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
