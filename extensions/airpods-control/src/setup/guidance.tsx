import { Action, Icon, Keyboard, openExtensionPreferences } from "@raycast/api";
import { CLI_SEARCH_PATHS } from "../cli/preferences";
import { compareVersions, normalizeVersion } from "../cli/version";
import { HOMEBREW_URL } from "../homebrew/constants";
import {
  CLI_INSTALL_COMMAND,
  CLI_INSTALL_DOCS_URL,
  CLI_LINK_COMMAND,
  CLI_MANUAL_UPDATE_COMMAND,
  CLI_SOURCE_INSTALL_COMMAND,
  DEVELOPER_TOOLS_DOCS_URL,
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
    notes.push("Could not determine the CLI version.");
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
    notes.push(`The CLI is older than the minimum this extension requires (${minimum}).`);
  }
  return notes.length > 0 ? `\n\n${notes.join("\n\n")}` : "";
}

function helperStatusMarkdown(title: string, setup: CliSetup, includeLatest: boolean): string {
  return `# ${title}\n\n${statusFacts(setup, includeLatest)}${statusNote(setup, includeLatest)}\n`;
}

export function cliSetupMarkdown(setup: CliSetup): string {
  switch (setup.state) {
    case "installing":
      return "# Installing or updating CLI…\n\nHomebrew already has an install or update in progress. This can take several minutes. Keep Raycast open until it finishes.";
    case "needs-homebrew":
      return `# Install Homebrew\n\nHomebrew is not installed.\n\nFollow [Homebrew's official installation instructions](${HOMEBREW_URL}).`;
    case "needs-developer-tools":
      return `# Install Apple's developer tools\n\nApple's developer tools are needed to install or update the CLI.\n\nFollow [Apple's official installation instructions](${DEVELOPER_TOOLS_DOCS_URL}).`;
    case "invalid-cli-path":
      return `# Fix CLI Path\n\nRaycast could not find the CLI at the saved **CLI Path**.\n\n${code(setup.configuredCliPath ?? "")}\n\nClear or correct it in Extension Preferences.`;
    case "manual-cli":
      if (setupNeedsUpdate(setup)) {
        return helperStatusMarkdown("Update AirPods Control CLI", setup, true);
      }
      return helperStatusMarkdown("AirPods Control CLI is up to date", setup, false);
    case "needs-link": {
      const searched = CLI_SEARCH_PATHS.map((path) => `\`${path}\``).join(" or ");
      const location = setup.brewCliPrefix ? `Homebrew reports the install at \`${setup.brewCliPrefix}\`. ` : "";
      return `# Finish AirPods Control CLI setup\n\nHomebrew has the CLI installed, but Raycast cannot find the \`airpods-control\` command.\n\n${location}Raycast looks for an executable at ${searched}. That gap usually means the formula is not linked.\n\nCopy the command, run it in Terminal, then return here and choose **Refresh**.\n\n${code(CLI_LINK_COMMAND)}\n\nIf \`brew link\` says the formula is already linked, or the CLI is somewhere else, set **CLI Path** in Extension Preferences to the \`airpods-control\` binary.`;
    }
    case "install":
      return `# Install AirPods Control CLI\n\nThe CLI is not installed. Homebrew and Apple's developer tools are ready.\n\nChoose **Install with Homebrew**, or copy the install command and run it in Terminal. Homebrew can take several minutes; keep Raycast open until it finishes. To install from source, follow the [installation instructions](${CLI_INSTALL_DOCS_URL}).`;
    case "update":
      if (setupNeedsUpdate(setup)) {
        return helperStatusMarkdown("Update AirPods Control CLI", setup, true);
      }
      return helperStatusMarkdown("AirPods Control CLI is up to date", setup, false);
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
        <Action.OpenInBrowser
          title="Open Apple's Installation Instructions"
          url={DEVELOPER_TOOLS_DOCS_URL}
          shortcut={Keyboard.Shortcut.Common.Open}
        />
      );
    case "invalid-cli-path":
      return <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />;
    case "needs-homebrew":
      return (
        <Action.OpenInBrowser
          title="Open Homebrew Installation Instructions"
          url={HOMEBREW_URL}
          shortcut={Keyboard.Shortcut.Common.Open}
        />
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
      return (
        <>
          <Action.CopyToClipboard title="Copy Link Command" content={CLI_LINK_COMMAND} />
          <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
        </>
      );
    case "installing":
      return null;
  }
}
