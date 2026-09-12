import { Action, ActionPanel, Detail, Icon, openExtensionPreferences, showToast, Toast } from "@raycast/api";
import { useEffect, useRef, useState } from "react";
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

Homebrew requires Apple's Command Line Tools. Install them first if needed:

\`\`\`
xcode-select --install
\`\`\`

## Installed somewhere else?

The extension looks for the binary in:

${CLI_SEARCH_PATHS.map((path) => `- \`${path}\``).join("\n")}

The extension checks these locations automatically. A custom **CLI Path** overrides automatic detection; clear that preference to restore automatic detection after installing with Homebrew.
`;

export function InstallCliView({ onRetry }: { onRetry: () => void }) {
  const [isInstalling, setIsInstalling] = useState(false);
  const isInstallingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  async function installWithBrew() {
    if (!isMountedRef.current || isInstallingRef.current) {
      return;
    }
    isInstallingRef.current = true;
    setIsInstalling(true);
    let toast: Toast | undefined;

    try {
      toast = await showToast({
        style: Toast.Style.Animated,
        title: "Installing airpods-control…",
        message: "Running brew install; this can take a few minutes",
      });
      if (!isMountedRef.current) {
        return;
      }
      await installCliWithBrew();
      if (!isMountedRef.current) {
        return;
      }
      toast.style = Toast.Style.Success;
      toast.title = "airpods-control installed";
      toast.message = undefined;
      onRetry();
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      if (!toast) {
        console.error("Failed to show the CLI install toast", error);
        return;
      }
      toast.style = Toast.Style.Failure;
      toast.title = "Install failed";
      toast.message = error instanceof Error ? error.message : String(error);
    } finally {
      isInstallingRef.current = false;
      if (isMountedRef.current) {
        setIsInstalling(false);
      }
    }
  }

  return (
    <Detail
      markdown={markdown}
      isLoading={isInstalling}
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
