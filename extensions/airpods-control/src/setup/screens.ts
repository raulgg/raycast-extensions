import { Keyboard } from "@raycast/api";
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
  CLI_REPO_HOME_URL,
  CLI_SOURCE_INSTALL_COMMAND,
  DEVELOPER_TOOLS_DOCS_URL,
  MIN_CLI_VERSION,
} from "./constants";
import { setupNeedsUpdate, type CliSetup, type CliSetupState } from "./detection";
import type { CliOperation } from "./installation";
import type { CliSetupLifecycle } from "./lifecycle";

export type SetupAction =
  | { type: "run"; title: string; operation: CliOperation }
  | { type: "copy"; title: string; content: string }
  | { type: "open"; title: string; url: string; shortcut?: Keyboard.Shortcut }
  | { type: "preferences"; title: string }
  | { type: "refresh"; title: string };

export interface SetupScreen {
  title: string;
  body: string;
  /** Action groups in panel order. Each group renders as one section. */
  actions: SetupAction[][];
  isLoading: boolean;
}

/** `update` and `manual-cli` each split into an update screen and a shared up-to-date screen. */
type SetupScreenKind = Exclude<CliSetupState, "manual-cli"> | "manual-update" | "up-to-date";

const INSTALL_DOCS: SetupAction = {
  type: "open",
  title: "Open Installation Instructions",
  url: CLI_INSTALL_DOCS_URL,
  shortcut: Keyboard.Shortcut.Common.Open,
};

const HOMEBREW_DOCS: SetupAction = {
  type: "open",
  title: "Open Homebrew Installation Instructions",
  url: HOMEBREW_URL,
  shortcut: Keyboard.Shortcut.Common.Open,
};

const DEVELOPER_TOOLS_DOCS: SetupAction = {
  type: "open",
  title: "Open Apple's Installation Instructions",
  url: DEVELOPER_TOOLS_DOCS_URL,
  shortcut: Keyboard.Shortcut.Common.Open,
};

const GITHUB: SetupAction = {
  type: "open",
  title: "Open AirPods Control on GitHub",
  url: CLI_REPO_HOME_URL,
  shortcut: Keyboard.Shortcut.Common.OpenWith,
};

const PREFERENCES: SetupAction = { type: "preferences", title: "Open Extension Preferences" };

const REFRESH: SetupAction = { type: "refresh", title: "Refresh" };

const OPERATION_PROGRESS: Record<CliOperation, string> = { install: "Installing", update: "Updating" };

const SETUP_SCREENS: Record<SetupScreenKind, (setup: CliSetup) => SetupScreen> = {
  installing: () =>
    screen({
      title: "Installing or updating CLI…",
      body: "Homebrew already has an install or update in progress. This can take several minutes. Keep Raycast running until it finishes.",
      actions: [[GITHUB], [REFRESH]],
      isLoading: true,
    }),
  "needs-homebrew": () =>
    screen({
      title: "Install Homebrew",
      body: `Homebrew is not installed.\n\nFollow [Homebrew's official installation instructions](${HOMEBREW_URL}).`,
      actions: [[HOMEBREW_DOCS, GITHUB], [REFRESH]],
    }),
  "needs-developer-tools": () =>
    screen({
      title: "Install Apple's developer tools",
      body: `Apple's developer tools are needed to install or update the CLI.\n\nFollow [Apple's official installation instructions](${DEVELOPER_TOOLS_DOCS_URL}).`,
      actions: [[DEVELOPER_TOOLS_DOCS, GITHUB], [REFRESH]],
    }),
  "invalid-cli-path": (setup) =>
    screen({
      title: "Fix CLI Path",
      body: `Raycast could not find the CLI at the saved **CLI Path**.\n\n${code(setup.configuredCliPath ?? "")}\n\nClear or correct it in Extension Preferences.`,
      actions: [[PREFERENCES], [GITHUB], [REFRESH]],
    }),
  "needs-link": (setup) =>
    screen({
      title: "Finish AirPods Control CLI setup",
      body: needsLinkBody(setup),
      actions: [
        [{ type: "copy", title: "Copy Link Command", content: cliLinkCommand(setup) }, PREFERENCES],
        [GITHUB],
        [REFRESH],
      ],
    }),
  "needs-reinstall": (setup) =>
    screen({
      title: "Repair AirPods Control CLI",
      body: `Homebrew lists the formula, but there is no usable \`${CLI_BINARY_NAME}\` binary at ${kegCliLabel(setup)}. The install is incomplete, so linking cannot fix it.\n\nCopy the command and run it in Terminal. Homebrew builds from source, so this can take several minutes.\n\n${code(CLI_REINSTALL_COMMAND)}`,
      actions: [
        [{ type: "copy", title: "Copy Reinstall Command", content: CLI_REINSTALL_COMMAND }],
        [GITHUB],
        [REFRESH],
      ],
    }),
  install: () =>
    screen({
      title: "Install AirPods Control CLI",
      body: `The CLI is not installed. Homebrew and Apple's developer tools are ready.\n\nChoose **Install with Homebrew**, or copy the install command and run it in Terminal. Homebrew can take several minutes; keep Raycast running until it finishes.\n\nTo install from source, follow the [installation instructions](${CLI_INSTALL_DOCS_URL}).`,
      actions: [
        [
          { type: "run", title: "Install with Homebrew", operation: "install" },
          { type: "copy", title: "Copy Install Command", content: CLI_INSTALL_COMMAND },
        ],
        [INSTALL_DOCS, GITHUB],
        [REFRESH],
      ],
    }),
  update: (setup) =>
    screen({
      title: "Update AirPods Control CLI",
      body: updateBody(setup, "homebrew"),
      actions: [
        [
          { type: "run", title: "Update with Homebrew", operation: "update" },
          { type: "copy", title: "Copy Update Command", content: CLI_MANUAL_UPDATE_COMMAND },
        ],
        [INSTALL_DOCS, GITHUB],
        [REFRESH],
      ],
    }),
  "manual-update": (setup) =>
    screen({
      title: "Update AirPods Control CLI",
      body: updateBody(setup, "manual"),
      actions: [
        [{ type: "copy", title: "Copy Source Install Command", content: CLI_SOURCE_INSTALL_COMMAND }],
        [INSTALL_DOCS, GITHUB],
        [REFRESH],
      ],
    }),
  "up-to-date": (setup) =>
    screen({
      title: "AirPods Control CLI is up to date",
      body: statusBody(setup, false),
      actions: [[GITHUB], [REFRESH]],
    }),
};

const LIFECYCLE_SCREENS: {
  [S in CliSetupLifecycle["status"]]: (lifecycle: Extract<CliSetupLifecycle, { status: S }>) => SetupScreen;
} = {
  checking: () =>
    screen({ title: "AirPods Control CLI", body: "Checking your installation…", actions: [], isLoading: true }),
  ready: ({ setup }) => setupScreen(setup),
  running: ({ operation }) =>
    screen({
      title: `${OPERATION_PROGRESS[operation]} CLI…`,
      body: "This can take several minutes. Keep Raycast running until it finishes.",
      actions: [],
      isLoading: true,
    }),
  failed: ({ error }) =>
    screen({
      title: "AirPods Control CLI needs attention",
      body: indent(error),
      actions: [[{ type: "copy", title: "Copy Error", content: error }], [INSTALL_DOCS, GITHUB], [REFRESH]],
    }),
};

export function lifecycleScreen(lifecycle: CliSetupLifecycle): SetupScreen {
  // The map is keyed by status, so the entry always accepts this lifecycle variant.
  const build = LIFECYCLE_SCREENS[lifecycle.status] as (lifecycle: CliSetupLifecycle) => SetupScreen;
  return build(lifecycle);
}

export function setupScreen(setup: CliSetup): SetupScreen {
  return SETUP_SCREENS[setupScreenKind(setup)](setup);
}

export function screenMarkdown({ title, body }: SetupScreen): string {
  return [`# ${title}`, body].filter(Boolean).join("\n\n");
}

function setupScreenKind(setup: CliSetup): SetupScreenKind {
  if (setup.state === "update") return setupNeedsUpdate(setup) ? "update" : "up-to-date";
  if (setup.state === "manual-cli") return setupNeedsUpdate(setup) ? "manual-update" : "up-to-date";
  return setup.state;
}

function screen(content: Omit<SetupScreen, "isLoading"> & Partial<Pick<SetupScreen, "isLoading">>): SetupScreen {
  return { isLoading: false, ...content };
}

function code(value: string): string {
  const fence = "`".repeat(Math.max(3, ...Array.from(value.matchAll(/`+/g), ([match]) => match.length + 1)));
  return `${fence}\n${value}\n${fence}`;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
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

function statusBody(setup: CliSetup, includeLatest: boolean): string {
  return `${statusFacts(setup, includeLatest)}${statusNote(setup, includeLatest)}`;
}

function updateBody(setup: CliSetup, method: "homebrew" | "manual"): string {
  const process =
    method === "homebrew"
      ? "Choose **Update with Homebrew** to install the latest version, or copy the update command and run it in your Terminal.\n\nHomebrew can take several minutes to install the update; keep Raycast running until it finishes."
      : `Copy the source install command and run it in your Terminal. Use the same installation method and location.\n\nFor the full source-install steps, follow the [installation instructions](${CLI_INSTALL_DOCS_URL}).`;
  return `${statusBody(setup, true)}\n\n${process}`;
}

function kegCliLabel(setup: CliSetup): string {
  return setup.brewCliPrefix ? `\`${brewPrefixCliPath(setup.brewCliPrefix)}\`` : "its Homebrew prefix";
}

/** Homebrew's own link status decides whether a plain link can succeed. */
function cliLinkCommand(setup: CliSetup): string {
  return setup.brewLinked === true ? CLI_RELINK_COMMAND : CLI_LINK_COMMAND;
}

function needsLinkBody(setup: CliSetup): string {
  const searched = CLI_SEARCH_PATHS.map((path) => `\`${path}\``).join(" or ");
  const cause =
    setup.brewLinked === true
      ? "Homebrew reports the formula as already linked, so the link is broken or something else owns that path."
      : setup.brewLinked === false
        ? `Homebrew has not linked the formula, so the \`${CLI_BINARY_NAME}\` command does not exist yet.`
        : "Homebrew could not report whether the formula is linked. An unlinked formula is the usual cause.";
  return `Homebrew installed the CLI at ${kegCliLabel(setup)}, but Raycast needs it at ${searched}.\n\n${cause}\n\nCopy the command and run it in Terminal.\n\n${code(cliLinkCommand(setup))}\n\nIf that does not help, set **CLI Path** in Extension Preferences to ${kegCliLabel(setup)}.`;
}
