import { Action, Icon, openExtensionPreferences } from "@raycast/api";
import { compareVersions, normalizeVersion } from "../cli/version";
import {
  CLI_INSTALL_COMMAND,
  CLI_LINK_COMMAND,
  CLI_MANUAL_UPDATE_COMMAND,
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
      return "# Install Homebrew\n\nHomebrew is not installed. Copy the install command, run it in Terminal, then Refresh.";
    case "needs-developer-tools": {
      const instructions =
        setup.developerTools === "unavailable"
          ? `Your Mac cannot use \`xcode-select\`. Download the Command Line Tools for your macOS version from [Apple Developer Downloads](${DEVELOPER_TOOLS_DOWNLOAD_URL}) and follow [Apple's installation instructions](${DEVELOPER_TOOLS_DOCS_URL}).`
          : `Choose the **Copy Developer Tools Install Command** action, paste the command into Terminal, and run it. If macOS says the tools are already installed, follow [Apple's instructions](${DEVELOPER_TOOLS_DOCS_URL}) to update them or select a working Xcode installation.`;
      return `# Install Apple's developer tools\n\nApple's developer tools are needed to install or update the helper.\n\n${instructions}`;
    }
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
      return "# Install the helper\n\nHomebrew and Apple's developer tools are ready.";
    case "update":
      if (setupNeedsUpdate(setup)) {
        return helperStatusMarkdown("Update the helper", setup, true);
      }
      return helperStatusMarkdown("AirPods Control Helper is Up to date", setup, false);
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
  if (setup.state === "update" && !setupNeedsUpdate(setup)) return null;
  const commands = {
    install: { title: "Copy Install Command", content: CLI_INSTALL_COMMAND },
    update: { title: "Copy Update Command", content: CLI_MANUAL_UPDATE_COMMAND },
    "needs-link": { title: "Copy Link Command", content: CLI_LINK_COMMAND },
  };
  return <Action.CopyToClipboard {...commands[setup.state]} />;
}
