import { Action, ActionPanel, Detail, Icon, openExtensionPreferences, showToast, Toast } from "@raycast/api";
import { useState } from "react";
import { installCliWithBrew } from "../core/brew";
import { CLI_INSTALL_COMMAND, CLI_REPO_URL, CLI_SEARCH_PATHS } from "../core/consts";

const markdown = `
# AirPods Control CLI Required

This command controls your AirPods through [airpods-control](${CLI_REPO_URL}), a command-line tool that couldn't be found on your Mac.

## Install with Homebrew

\`\`\`
${CLI_INSTALL_COMMAND}
\`\`\`

Press **Enter** to copy the install command, or use the **Install with Homebrew** action to run it for you. Once installed, run this command again.

## Installed somewhere else?

The extension looks for the binary in:

${CLI_SEARCH_PATHS.map((path) => `- \`${path}\``).join("\n")}

If you installed it elsewhere, set the full binary path in the **CLI Path** extension preference.
`;

export function InstallCliView({ onRetry }: { onRetry: () => void }) {
  const [isInstalling, setIsInstalling] = useState(false);

  async function installWithBrew() {
    if (isInstalling) {
      return;
    }
    setIsInstalling(true);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Installing airpods-control…",
      message: "Running brew install; this can take a few minutes",
    });
    try {
      await installCliWithBrew();
      toast.style = Toast.Style.Success;
      toast.title = "airpods-control installed";
      toast.message = undefined;
      onRetry();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Install failed";
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      setIsInstalling(false);
    }
  }

  return (
    <Detail
      markdown={markdown}
      isLoading={isInstalling}
      navigationTitle="Install AirPods Control CLI"
      actions={
        <ActionPanel>
          <Action.CopyToClipboard title="Copy Install Command" content={CLI_INSTALL_COMMAND} />
          <Action title="Install with Homebrew" icon={Icon.Download} onAction={installWithBrew} />
          <Action title="Retry Detection" icon={Icon.ArrowClockwise} onAction={onRetry} />
          <Action.OpenInBrowser title="Open Airpods-Control on GitHub" url={CLI_REPO_URL} />
          <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
        </ActionPanel>
      }
    />
  );
}
