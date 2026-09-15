import { Action, Icon, openExtensionPreferences } from "@raycast/api";
import { compareVersions, normalizeVersion } from "../cli/version";
import { HOMEBREW_URL } from "../homebrew/constants";
import {
  CLI_INSTALL_COMMAND,
  CLI_INSTALL_DOCS_URL,
  CLI_LINK_COMMAND,
  CLI_MANUAL_UPDATE_COMMAND,
  CLI_SOURCE_INSTALL_COMMAND,
  DEVELOPER_TOOLS_DOCS_URL,
  DEVELOPER_TOOLS_DOWNLOAD_URL,
  DEVELOPER_TOOLS_INSTALL_COMMAND,
  HOMEBREW_INSTALL_COMMAND,
  MIN_CLI_VERSION,
} from "./constants";
import { setupNeedsUpdate, type CliSetup } from "./detection";

function code(value: string): string {
  const fence = "`".repeat(Math.max(3, ...Array.from(value.matchAll(/`+/g), ([match]) => match.length + 1)));
  return `${fence}\n${value}\n${fence}`;
}

function methodLabel(setup: CliSetup): string {
  if (setup.installationMethod === "homebrew") return "Homebrew";
  if (setup.installationMethod === "manual") return "Manual";
  return "unknown";
}

function statusFacts(setup: CliSetup, includeLatest: boolean): string {
  const lines = [
    `- **Version:** ${setup.installedVersion ?? "unknown"}`,
    includeLatest ? `- **Latest:** ${setup.latestVersion ?? "unknown"}` : undefined,
    `- **Installed with:** ${methodLabel(setup)}`,
    setup.cliPath ? `- **Path:** \`${setup.cliPath}\`` : undefined,
  ];
  return lines.filter((line) => line !== undefined).join("\n");
}

function statusNote(setup: CliSetup, includeLatest: boolean): string {
  const notes: string[] = [];
  if (includeLatest && setup.versionStatus === "unknown") {
    notes.push("Could not determine the helper version.");
  } else if (
    setup.installedVersion &&
    setup.latestVersion &&
    compareVersions(setup.installedVersion, setup.latestVersion) === 1
  ) {
    notes.push("This install is newer than the known release.");
  } else if (setup.liveCheckFailed) {
    notes.push("Could not confirm the latest release.");
  } else if (setup.configuredCliPath) {
    notes.push("Using the saved **CLI Path**.");
  }
  if (setup.meetsMinimum === false) {
    const minimum = normalizeVersion(MIN_CLI_VERSION) ?? MIN_CLI_VERSION;
    notes.push(`The helper is older than the minimum this extension requires (${minimum}).`);
  }
  return notes.length > 0 ? `\n\n${notes.join("\n\n")}` : "";
}

function helperStatusMarkdown(title: string, setup: CliSetup, includeLatest: boolean): string {
  return `# ${title}\n\n${statusFacts(setup, includeLatest)}${statusNote(setup, includeLatest)}\n`;
}

export function cliSetupMarkdown(setup: CliSetup): string {
  switch (setup.state) {
    case "installing":
      return "# Setup is already running\n\nWait for it to finish, then Refresh.";
    case "needs-homebrew":
      return `# Install Homebrew\n\nHomebrew is not installed.\n\nCopy the install command and run it in Terminal, then Refresh. Follow [Homebrew's installation instructions](${HOMEBREW_URL}).`;
    case "needs-developer-tools":
      return `# Install Apple's developer tools\n\nApple's developer tools are needed to install or update the helper.\n\nCopy the install command and run it in Terminal. If that command is not available, or macOS says the tools are already installed, download the Command Line Tools from [Apple Developer Downloads](${DEVELOPER_TOOLS_DOWNLOAD_URL}) and follow [Apple's installation instructions](${DEVELOPER_TOOLS_DOCS_URL}).`;
    case "invalid-cli-path":
      return `# Fix CLI Path\n\nRaycast could not find the helper at the saved **CLI Path**.\n\n${code(setup.configuredCliPath ?? "")}\n\nClear or correct it in Extension Preferences.`;
    case "manual-cli":
      if (setupNeedsUpdate(setup)) {
        return helperStatusMarkdown("Update AirPods Control Helper", setup, true);
      }
      return helperStatusMarkdown("AirPods Control Helper is up to date", setup, false);
    case "needs-link":
      return `# Finish setup\n\nHomebrew installed the helper, but Raycast cannot find it.\n\n${code(CLI_LINK_COMMAND)}`;
    case "install":
      return `# Install AirPods Control Helper\n\nThe helper is not installed. Homebrew and Apple's developer tools are ready.\n\nChoose **Install with Homebrew**, or copy the install command and run it in Terminal. Homebrew can take several minutes; keep Raycast open until it finishes. To install from source, follow the [installation instructions](${CLI_INSTALL_DOCS_URL}).`;
    case "update":
      if (setupNeedsUpdate(setup)) {
        return helperStatusMarkdown("Update the helper", setup, true);
      }
      return helperStatusMarkdown("AirPods Control Helper is Up to date", setup, false);
  }
}

export function hasCliSetupActions(setup: CliSetup): boolean {
  switch (setup.state) {
    case "installing":
      return false;
    case "update":
    case "manual-cli":
      return setupNeedsUpdate(setup);
    default:
      return true;
  }
}

export function CliSetupActions({ setup }: { setup: CliSetup }) {
  if (!hasCliSetupActions(setup)) return null;
  switch (setup.state) {
    case "needs-developer-tools":
      return (
        <Action.CopyToClipboard
          title="Copy Developer Tools Install Command"
          content={DEVELOPER_TOOLS_INSTALL_COMMAND}
        />
      );
    case "invalid-cli-path":
      return <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />;
    case "needs-homebrew":
      return (
        <>
          <Action.CopyToClipboard title="Copy Homebrew Install Command" content={HOMEBREW_INSTALL_COMMAND} />
          <Action.CopyToClipboard title="Copy Source Install Command" content={CLI_SOURCE_INSTALL_COMMAND} />
        </>
      );
    case "manual-cli":
      return <Action.CopyToClipboard title="Copy Source Install Command" content={CLI_SOURCE_INSTALL_COMMAND} />;
    case "install":
      return (
        <>
          <Action.CopyToClipboard title="Copy Install Command" content={CLI_INSTALL_COMMAND} />
          <Action.CopyToClipboard title="Copy Source Install Command" content={CLI_SOURCE_INSTALL_COMMAND} />
        </>
      );
    case "update":
      return <Action.CopyToClipboard title="Copy Update Command" content={CLI_MANUAL_UPDATE_COMMAND} />;
    case "needs-link":
      return <Action.CopyToClipboard title="Copy Link Command" content={CLI_LINK_COMMAND} />;
    case "installing":
      return null;
  }
}
