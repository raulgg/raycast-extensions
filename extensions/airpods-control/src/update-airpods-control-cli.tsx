import { Action, ActionPanel, Detail, Icon, showToast, Toast } from "@raycast/api";
import { showFailureToast } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import { findBrewPath, installCliWithBrew, updateCliWithBrew } from "./core/brew";
import { findCliPath } from "./core/cli";
import { runBrewOperationWithProgress } from "./core/cli-installation";
import { CLI_INSTALL_COMMAND, CLI_REPO_URL, CLI_UPDATE_COMMAND, HOMEBREW_URL } from "./core/consts";
import { createCopyErrorAction, getErrorMessage } from "./core/toast-manager";

type Detection = {
  brewPath: string | null;
  cliPath: string | null;
};

function detect(): Detection {
  return { brewPath: findBrewPath(), cliPath: findCliPath() };
}

function markdownFor(detection: Detection | null, isRunning: boolean): string {
  if (!detection) {
    return "# Update airpods-control CLI\n\nChecking for Homebrew and the CLI…";
  }

  if (!detection.brewPath) {
    return `
# Homebrew required

Homebrew is needed to install or update the [airpods-control](${CLI_REPO_URL}) CLI.

Open [brew.sh](${HOMEBREW_URL}) to install Homebrew, then run **Retry Detection** below. Apple’s Command Line Tools may also be required:

\`\`\`bash
xcode-select --install
\`\`\`

After Homebrew is ready, this command can install the CLI with:

\`\`\`bash
${CLI_INSTALL_COMMAND}
\`\`\`
`;
  }

  if (isRunning) {
    return `
# Updating airpods-control CLI

Homebrew is updating the CLI. Keep Raycast open until the progress toast finishes.
`;
  }

  if (detection.cliPath) {
    return `
# airpods-control CLI detected

The CLI is available at:

\`\`\`
${detection.cliPath}
\`\`\`

Update it with Homebrew when a newer version is available:

\`\`\`bash
${CLI_UPDATE_COMMAND}
\`\`\`
`;
  }

  return `
# airpods-control CLI not found

Homebrew is ready, but the CLI is not installed. Install it with:

\`\`\`bash
${CLI_INSTALL_COMMAND}
\`\`\`
`;
}

export default function Command() {
  const [detection, setDetection] = useState<Detection | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const isRunningRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    setDetection(detect());
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  function retryDetection() {
    if (!isMountedRef.current || isRunningRef.current) return;
    setDetection(detect());
  }

  async function updateCli() {
    if (!detection?.brewPath || isRunningRef.current) return;

    isRunningRef.current = true;
    setIsRunning(true);
    const shouldUpdate = detection.cliPath !== null;
    let toast: Toast | undefined;

    try {
      toast = await showToast({
        style: Toast.Style.Animated,
        title: shouldUpdate ? "Updating airpods-control CLI…" : "Installing airpods-control CLI…",
        message: "Homebrew can take several minutes. Keep Raycast open to see progress.",
      });
      await runBrewOperationWithProgress(toast, shouldUpdate ? updateCliWithBrew : installCliWithBrew);

      const nextDetection = detect();
      if (!nextDetection.cliPath) {
        throw new Error("The CLI still could not be detected. Check CLI Path in the extension preferences.");
      }

      toast.style = Toast.Style.Success;
      toast.title = shouldUpdate ? "airpods-control CLI updated" : "airpods-control CLI installed";
      toast.message = "Run your AirPods command again to use it.";
      await toast.show();
      if (isMountedRef.current) setDetection(nextDetection);
    } catch (error) {
      const message = getErrorMessage(error);
      if (toast) {
        toast.style = Toast.Style.Failure;
        toast.title = shouldUpdate ? "CLI update failed" : "CLI installation failed";
        toast.message = message;
        toast.primaryAction = createCopyErrorAction(message);
        await toast.show();
      } else {
        await showFailureToast(error, {
          title: shouldUpdate ? "CLI update failed" : "CLI installation failed",
          message,
          primaryAction: createCopyErrorAction(message),
        });
      }
    } finally {
      isRunningRef.current = false;
      if (isMountedRef.current) setIsRunning(false);
    }
  }

  const canRun = Boolean(detection?.brewPath) && !isRunning;
  const hasCli = Boolean(detection?.cliPath);
  const command = hasCli ? CLI_UPDATE_COMMAND : CLI_INSTALL_COMMAND;

  return (
    <Detail
      markdown={markdownFor(detection, isRunning)}
      isLoading={!detection || isRunning}
      actions={
        <ActionPanel>
          {canRun ? (
            <Action
              title={hasCli ? "Update with Homebrew" : "Install with Homebrew"}
              icon={Icon.Download}
              onAction={updateCli}
            />
          ) : null}
          {!detection?.brewPath ? <Action.OpenInBrowser title="Open Homebrew Website" url={HOMEBREW_URL} /> : null}
          <Action.CopyToClipboard title={hasCli ? "Copy Update Command" : "Copy Install Command"} content={command} />
          <Action title="Retry Detection" icon={Icon.ArrowClockwise} onAction={retryDetection} />
          <Action.OpenInBrowser title="Open AirPods Control on GitHub" url={CLI_REPO_URL} />
        </ActionPanel>
      }
    />
  );
}
