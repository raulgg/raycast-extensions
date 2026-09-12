import { Action, Icon, openExtensionPreferences } from "@raycast/api";
import {
  CLI_INSTALL_COMMAND,
  CLI_LINK_COMMAND,
  CLI_MANUAL_UPDATE_COMMAND,
  DEVELOPER_TOOLS_DOCS_URL,
  DEVELOPER_TOOLS_DOWNLOAD_URL,
  DEVELOPER_TOOLS_INSTALL_COMMAND,
  HOMEBREW_INSTALL_COMMAND,
  HOMEBREW_URL,
} from "../core/consts";
import type { CliSetup } from "../core/cli-setup";

function code(value: string): string {
  const fence = "`".repeat(Math.max(3, ...Array.from(value.matchAll(/`+/g), ([match]) => match.length + 1)));
  return `${fence}\n${value}\n${fence}`;
}

export function cliSetupMarkdown(setup: CliSetup): string {
  switch (setup.state) {
    case "installing":
      return "# Setup is already running\n\nAn installation or update is already running. Wait for it to finish, then choose the **Refresh** action. When setup is complete, run your AirPods command again.";
    case "needs-homebrew":
      return `# Install the helper

Homebrew is not installed. Homebrew installs and updates the helper.

1. Choose the **Copy Homebrew Install Command** action, paste it into Terminal, and run it.
2. Follow the installer prompts. It may ask for your Mac login password. See the [Homebrew installation instructions](${HOMEBREW_URL}) if you need help.
3. Return here and choose the **Refresh** action. Then choose the **Install with Homebrew** action.
`;
    case "needs-developer-tools": {
      const instructions =
        setup.developerTools === "unavailable"
          ? `Your Mac cannot use \`xcode-select\`. Download the Command Line Tools for your macOS version from [Apple Developer Downloads](${DEVELOPER_TOOLS_DOWNLOAD_URL}) and follow [Apple's installation instructions](${DEVELOPER_TOOLS_DOCS_URL}).`
          : `Choose the **Copy Developer Tools Install Command** action, paste the command into Terminal, and run it. If macOS says the tools are already installed, follow [Apple's instructions](${DEVELOPER_TOOLS_DOCS_URL}) to update them or select a working Xcode installation.`;
      return `# Install Apple's developer tools\n\nApple's developer tools are needed to install or update the helper.\n\n${instructions}\n\nWhen installation finishes, return here and choose the **Refresh** action.${setup.cliPath ? " You can keep using your AirPods commands." : ""}`;
    }
    case "invalid-cli-path":
      return `# Fix CLI Path\n\nRaycast could not find the helper at the saved **CLI Path**:\n\n${code(setup.configuredCliPath ?? "")}\n\nChoose the **Open Extension Preferences** action and clear **CLI Path** to let Raycast find the helper automatically. If you use a custom location, correct the saved path instead. Then choose the **Refresh** action.`;
    case "manual-cli":
      return `# Update the helper\n\nThis helper needs to be updated manually. Choose the **Open Update Instructions** action and follow the instructions for the method you originally used. Keep the same installation location.\n\nWhen the update finishes, return here and choose the **Refresh** action. Your AirPods commands will use the updated helper.`;
    case "needs-link":
      return `# Finish setting up the helper\n\nHomebrew installed the helper, but Raycast cannot find it. Open Terminal and run:\n\n${code(CLI_LINK_COMMAND)}\n\nIf Homebrew reports a conflicting file, follow its instructions before retrying. Then choose the **Refresh** action. If linking does not work, choose the **Open Extension Preferences** action and set **CLI Path** to the helper's executable.`;
    case "install":
      return `# Install the helper\n\nInstall the helper to control your AirPods from Raycast. Homebrew and Apple's developer tools are ready.\n\nChoose the **Install with Homebrew** action to install it directly in Raycast. Keep Raycast open while it finishes. When it finishes, run your AirPods command again.\n\nTo install from Terminal, choose the **Copy Install Command** action and run the command there. To install without Homebrew, choose the **Copy Source Install Command** action.`;
    case "update":
      return `# Update the helper\n\nChoose the **Update with Homebrew** action to update the helper directly in Raycast. Keep Raycast open while it finishes.\n\n## Update manually in Terminal\n\nOpen Terminal and run these commands to update Homebrew and the helper:\n\n${code(CLI_MANUAL_UPDATE_COMMAND)}\n\nChoose the **Copy Update Command** action to copy both commands. After Homebrew finishes, return to Raycast and choose the **Refresh** action.`;
  }
}

export function CliSetupActions({ setup }: { setup: CliSetup }) {
  if (setup.state === "installing") return null;
  if (setup.state === "needs-developer-tools") {
    return (
      <>
        {setup.developerTools === "missing" && (
          <Action.CopyToClipboard
            title="Copy Developer Tools Install Command"
            content={DEVELOPER_TOOLS_INSTALL_COMMAND}
          />
        )}
        <Action.OpenInBrowser title="Open Apple Developer Downloads" url={DEVELOPER_TOOLS_DOWNLOAD_URL} />
        <Action.OpenInBrowser title="Open Developer Tools Instructions" url={DEVELOPER_TOOLS_DOCS_URL} />
      </>
    );
  }
  if (setup.state === "invalid-cli-path") {
    return <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />;
  }
  if (setup.state === "needs-homebrew") {
    return <Action.CopyToClipboard title="Copy Homebrew Install Command" content={HOMEBREW_INSTALL_COMMAND} />;
  }
  if (setup.state === "manual-cli") return null;
  const commands = {
    install: { title: "Copy Install Command", content: CLI_INSTALL_COMMAND },
    update: { title: "Copy Update Command", content: CLI_MANUAL_UPDATE_COMMAND },
    "needs-link": { title: "Copy Link Command", content: CLI_LINK_COMMAND },
  };
  return <Action.CopyToClipboard {...commands[setup.state]} />;
}
