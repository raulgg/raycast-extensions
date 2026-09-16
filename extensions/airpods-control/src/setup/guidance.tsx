import { Action, Icon, Keyboard, openExtensionPreferences } from "@raycast/api";
import { brewPrefixCliPath } from "../cli/discovery";
import { CLI_BINARY_NAME, CLI_SEARCH_PATHS } from "../cli/preferences";
import { compareVersions, normalizeVersion } from "../cli/version";
import { HOMEBREW_URL } from "../homebrew/constants";
import {
  CLI_INSTALL_COMMAND,
  CLI_INSTALL_DOCS_URL,
  CLI_LINK_COMMAND,
  CLI_MANUAL_UPDATE_COMMAND,
  CLI_REINSTALL_COMMAND,
  CLI_RELINK_COMMAND,
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
    `- **Install method:** ${methodLabel(setup)}`,
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

function kegCliLabel(setup: CliSetup): string {
  return setup.brewCliPrefix ? `\`${brewPrefixCliPath(setup.brewCliPrefix)}\`` : "its Homebrew prefix";
}

/** Homebrew's own link status decides whether a plain link can succeed. */
function cliLinkCommand(setup: CliSetup): string {
  return setup.brewLinked === true ? CLI_RELINK_COMMAND : CLI_LINK_COMMAND;
}

function needsLinkMarkdown(setup: CliSetup): string {
  const searched = CLI_SEARCH_PATHS.map((path) => `\`${path}\``).join(" or ");
  const cause =
    setup.brewLinked === true
      ? "Homebrew reports the formula as already linked, so the link is broken or something else owns that path."
      : setup.brewLinked === false
        ? `Homebrew has not linked the formula, so the \`${CLI_BINARY_NAME}\` command does not exist yet.`
        : "Homebrew could not report whether the formula is linked. An unlinked formula is the usual cause.";
  return `# Finish AirPods Control CLI setup\n\nHomebrew installed the CLI at ${kegCliLabel(setup)}, but Raycast needs it at ${searched}.\n\n${cause}\n\nCopy the command and run it in Terminal.\n\n${code(cliLinkCommand(setup))}\n\nIf that does not help, set **CLI Path** in Extension Preferences to ${kegCliLabel(setup)}.`;
}

function needsReinstallMarkdown(setup: CliSetup): string {
  return `# Repair AirPods Control CLI\n\nHomebrew lists the formula, but there is no usable \`${CLI_BINARY_NAME}\` binary at ${kegCliLabel(setup)}. The install is incomplete, so linking cannot fix it.\n\nCopy the command and run it in Terminal. Homebrew builds from source, so this can take several minutes.\n\n${code(CLI_REINSTALL_COMMAND)}`;
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
    case "needs-link":
      return needsLinkMarkdown(setup);
    case "needs-reinstall":
      return needsReinstallMarkdown(setup);
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
          <Action.CopyToClipboard title="Copy Link Command" content={cliLinkCommand(setup)} />
          <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
        </>
      );
    case "needs-reinstall":
      return <Action.CopyToClipboard title="Copy Reinstall Command" content={CLI_REINSTALL_COMMAND} />;
    case "installing":
      return null;
  }
}
