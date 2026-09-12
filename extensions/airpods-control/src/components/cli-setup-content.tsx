import { Action, Icon, openExtensionPreferences } from "@raycast/api";
import {
  CLI_INSTALL_COMMAND,
  CLI_INSTALL_DOCS_URL,
  CLI_LINK_COMMAND,
  CLI_UPDATE_COMMAND,
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
  const detected = setup.cliPath ? `The CLI is available at:\n\n${code(setup.cliPath)}\n\n` : "";
  switch (setup.state) {
    case "installing":
      return "# CLI installation is running\n\nAnother command is installing or updating the CLI. Wait for it to finish, then choose **Refresh Setup**. Run your AirPods command again once setup is complete.";
    case "needs-homebrew":
      return `# Install airpods-control CLI

## Install Homebrew first

1. Choose **Copy Homebrew Install Command**, paste it into Terminal, and run it.
2. Follow the installer prompts. It may ask for your Mac login password. See the [Homebrew installation instructions](${HOMEBREW_URL}) if you need help.
3. Return here and choose **Refresh Setup**. Then choose **Install with Homebrew** to install the CLI.

${code(HOMEBREW_INSTALL_COMMAND)}

### Alternative: install from source

If you prefer to skip Homebrew, use the [tagged source-install instructions](${CLI_INSTALL_DOCS_URL}). You can copy the source install command from the Action Panel. After installation, choose **Refresh Setup**.`;
    case "needs-developer-tools": {
      const instructions =
        setup.developerTools === "unavailable"
          ? `The \`xcode-select\` command is unavailable. Download the Command Line Tools for your macOS version from [Apple Developer Downloads](${DEVELOPER_TOOLS_DOWNLOAD_URL}) and follow [Apple's installation instructions](${DEVELOPER_TOOLS_DOCS_URL}).`
          : `Install Apple's Command Line Tools by running this in Terminal:\n\n${code(DEVELOPER_TOOLS_INSTALL_COMMAND)}\n\nIf macOS says they are already installed, follow [Apple's instructions](${DEVELOPER_TOOLS_DOCS_URL}) to update the tools or select a working Xcode installation.`;
      return `# Set up developer tools\n\n${detected}Installing or updating this CLI requires a working Swift toolchain.\n\n${instructions}\n\nWait for the installation to finish, then return here and choose **Refresh Setup**.${setup.cliPath ? " You can keep using your existing CLI with the AirPods commands." : ""}`;
    }
    case "invalid-cli-path":
      return `# Check CLI Path\n\nThe custom CLI Path does not point to an executable file:\n\n${code(setup.configuredCliPath ?? "")}\n\nOpen **Extension Preferences** and correct this path, or clear it to restore automatic detection. Then choose **Refresh Setup**.`;
    case "manual-cli":
      return `# Update airpods-control CLI\n\n${detected}This CLI is not managed by the detected Homebrew installation. Update it using the same method and installation location you originally used.\n\nFor a source installation, follow the [tagged source-install instructions](${CLI_INSTALL_DOCS_URL}). The default installer uses /usr/local; preserve your original prefix if it differs.\n\nTo switch to Homebrew, follow the source uninstall instructions first, install the Homebrew formula, and clear any old **CLI Path** preference. Choose **Refresh Setup** when finished. Your AirPods commands can keep using the existing CLI.`;
    case "needs-link":
      return `# Finish CLI setup\n\nHomebrew has the CLI installed, but the extension cannot find its executable. Try linking it in Terminal:\n\n${code(CLI_LINK_COMMAND)}\n\nIf Homebrew reports a conflicting file, follow its instructions before retrying. Then choose **Refresh Setup**. You can also set **CLI Path** to your installed executable in Extension Preferences.`;
    case "install":
      return `# Install airpods-control CLI\n\nHomebrew and the developer tools are ready. Choose **Install with Homebrew** to run:\n\n${code(CLI_INSTALL_COMMAND)}\n\nInstallation can take several minutes. When it finishes, run your AirPods command again.`;
    case "update":
      return `# Update airpods-control CLI\n\n${detected}This CLI is managed by Homebrew. Choose **Update with Homebrew** to check for and install an update:\n\n${code(CLI_UPDATE_COMMAND)}\n\nWhen it finishes, run your AirPods command again.`;
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
    update: { title: "Copy Update Command", content: CLI_UPDATE_COMMAND },
    "needs-link": { title: "Copy Link Command", content: CLI_LINK_COMMAND },
  };
  return <Action.CopyToClipboard {...commands[setup.state]} />;
}
