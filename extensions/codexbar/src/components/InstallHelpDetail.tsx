import { Action, ActionPanel, Detail, Icon } from "@raycast/api";
import type { InstallHelpState } from "../lib/codexbar";

type InstallHelpDetailProps = {
  install: InstallHelpState;
  onRetry: () => void;
};

export function InstallHelpDetail({ install, onRetry }: InstallHelpDetailProps) {
  return (
    <Detail
      markdown={install.markdown}
      actions={
        <ActionPanel>
          <Action title="Retry" icon={Icon.ArrowClockwise} onAction={onRetry} />
          <Action.OpenInBrowser title="Open CLI Docs" url={install.docsUrl} icon={Icon.Book} />
          <Action.OpenInBrowser title="Open Releases" url={install.releasesUrl} icon={Icon.Download} />
          <Action.OpenInBrowser title="Open Repository" url={install.repositoryUrl} icon={Icon.Code} />
          {install.homebrewCommand ? (
            <Action.CopyToClipboard
              title="Copy Homebrew Command"
              content={install.homebrewCommand}
              icon={Icon.Clipboard}
            />
          ) : null}
        </ActionPanel>
      }
    />
  );
}
