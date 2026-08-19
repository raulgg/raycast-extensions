import { constants } from "node:fs";
import { access, readlink, stat, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

// `installCodexBarCli` is a faithful port of the CodexBar app's own Install CLI
// button — `installCLI()` in `Sources/CodexBar/PreferencesAdvancedPane.swift` @
// v0.45.1 (757f1ca), see docs/upstream-parity.md surface 6 and ADR-0008. The
// refusals below are load-bearing, not oversights.

const CODEXBAR_APP_HELPER_RELATIVE_PATH = "Contents/Helpers/CodexBarCLI";
const DEFAULT_APP_BUNDLE_PATHS = ["/Applications/CodexBar.app", join(homedir(), "Applications", "CodexBar.app")];
const DEFAULT_BREW_PATHS = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];
// Upstream's order — do not reorder.
const DEFAULT_INSTALL_BIN_DIRS = ["/usr/local/bin", "/opt/homebrew/bin"];

const CODEXBAR_DOCS_URL = "https://github.com/steipete/CodexBar/blob/main/docs/cli.md";
const CODEXBAR_RELEASES_URL = "https://github.com/steipete/CodexBar/releases";
const CODEXBAR_REPOSITORY_URL = "https://github.com/steipete/CodexBar";
const CODEXBAR_DOWNLOAD_URL = "https://codexbar.app/";

// Fully qualified with an explicit --cask/--formula: the tap holds a formula
// AND a cask both named `codexbar`, so a bare `brew install steipete/tap/codexbar`
// warns and silently picks the formula.
export const HOMEBREW_APP_AND_CLI_COMMAND = "brew install --cask steipete/tap/codexbar";
export const HOMEBREW_CLI_ONLY_COMMAND = "brew install --formula steipete/tap/codexbar";

export type InstallHelpState =
  | {
      kind: "app-missing";
      title: string;
      markdown: string;
      docsUrl: string;
      releasesUrl: string;
      repositoryUrl: string;
      homebrewCommands?: { appAndCli: string; cliOnly: string };
    }
  | {
      kind: "cli-missing";
      title: string;
      markdown: string;
      docsUrl: string;
      releasesUrl: string;
      repositoryUrl: string;
      helperPath: string;
    };

export type InstallResult = {
  /** Per-directory outcomes, verbatim upstream strings ("Installed: {dir}", "Exists: {dir}", …). */
  results: string[];
  /** Upstream's joined status line, for the opt-in Copy Details payload — never for UI copy. */
  statusLine: string;
};

// "Installed" means the bundled helper is executable — what the install routine
// actually needs — so an older app without it reads as missing. No mdfind: it
// returns `~/.Trash` hits and is empty when Spotlight indexing is off.
export async function findCodexBarApp(
  appBundlePaths: readonly string[] = DEFAULT_APP_BUNDLE_PATHS,
): Promise<string | undefined> {
  for (const appBundlePath of appBundlePaths) {
    const helperPath = join(appBundlePath, CODEXBAR_APP_HELPER_RELATIVE_PATH);
    if (await isExecutableFile(helperPath)) {
      return helperPath;
    }
  }

  return undefined;
}

export async function detectHomebrew(brewPaths: readonly string[] = DEFAULT_BREW_PATHS): Promise<string | undefined> {
  for (const brewPath of brewPaths) {
    if (await isExecutableFile(brewPath)) {
      return dirname(dirname(brewPath));
    }
  }

  return undefined;
}

// Best-effort over every dir, so partial success is a normal outcome: callers
// judge success by re-running the availability gate (`resolveCodexBarBinary(policy)`
// plus the `--version` smoke test), never by the results.
export async function installCodexBarCli(
  helperPath: string,
  options?: { binDirs?: readonly string[] },
): Promise<InstallResult> {
  if (!(await fileExists(helperPath))) {
    return { results: [], statusLine: "CodexBarCLI not found in app bundle." };
  }

  const results: string[] = [];
  for (const dir of options?.binDirs ?? DEFAULT_INSTALL_BIN_DIRS) {
    // No mkdir: a missing prefix is skipped without a result entry.
    if (!(await fileExists(dir))) {
      continue;
    }

    // No privilege escalation: a non-writable dir is reported, not sudo'd.
    if (!(await isWritable(dir))) {
      results.push(`No write access: ${dir}`);
      continue;
    }

    const destination = join(dir, "codexbar");
    if (await fileExists(destination)) {
      // Never overwrites (no `ln -sf`): a foreign file is reported and left alone.
      results.push((await isLinkTo(destination, helperPath)) ? `Installed: ${dir}` : `Exists: ${dir}`);
      continue;
    }

    try {
      await symlink(helperPath, destination);
      results.push(`Installed: ${dir}`);
    } catch {
      // A dangling destination link lands here: it reads as absent above, then
      // fails with EEXIST. Upstream reports that as a failure too.
      results.push(`Failed: ${dir}`);
    }
  }

  return {
    results,
    statusLine: results.length === 0 ? "No writable bin dirs found." : results.join(" · "),
  };
}

// The app bundle a helper path belongs to (`…/CodexBar.app/Contents/Helpers/CodexBarCLI`).
export function codexBarAppPathForHelper(helperPath: string): string {
  return dirname(dirname(dirname(helperPath)));
}

// App presence only picks which help view renders — it never gates usage. Copy
// stays high-level: no filesystem paths anywhere in the markdown.
export function buildInstallHelp(context: {
  helperPath?: string;
  homebrewPrefix?: string;
  arch?: string;
}): InstallHelpState {
  const shared = {
    docsUrl: CODEXBAR_DOCS_URL,
    releasesUrl: CODEXBAR_RELEASES_URL,
    repositoryUrl: CODEXBAR_REPOSITORY_URL,
  };

  if (context.helperPath) {
    return {
      kind: "cli-missing",
      title: "Set Up CodexBar CLI",
      markdown: CLI_MISSING_MARKDOWN,
      helperPath: context.helperPath,
      ...shared,
    };
  }

  const hasHomebrew = Boolean(context.homebrewPrefix);
  return {
    kind: "app-missing",
    title: "Install CodexBar CLI",
    markdown: buildAppMissingMarkdown(hasHomebrew, context.arch ?? process.arch),
    ...(hasHomebrew
      ? { homebrewCommands: { appAndCli: HOMEBREW_APP_AND_CLI_COMMAND, cliOnly: HOMEBREW_CLI_ONLY_COMMAND } }
      : {}),
    ...shared,
  };
}

// Homebrew routes are deliberately not offered here: the app is already
// present, so a formula install would fetch a second, independently-versioned
// CLI that collides with the cask's own `codexbar` link.
const CLI_MISSING_MARKDOWN = [
  "# CodexBar CLI not set up",
  "",
  "The CodexBar app is installed, but the CodexBar CLI it includes isn't set up yet.",
  "This extension reads your usage through that CLI.",
  "",
  "Set it up from here — quick, and no password needed.",
  "",
  "Or do it in the app:",
  "",
  "1. Open CodexBar",
  "2. Settings → Advanced",
  "3. Click Install CLI",
  "4. Return here and press Retry",
].join("\n");

function buildAppMissingMarkdown(hasHomebrew: boolean, arch: string): string {
  const releaseArchive = arch === "arm64" ? "CodexBarCLI-…-macos-arm64" : "CodexBarCLI-…-macos-x86_64";
  const appRoute = hasHomebrew
    ? ["```", HOMEBREW_APP_AND_CLI_COMMAND, "```"]
    : [
        `1. Download the CodexBar app from [codexbar.app](${CODEXBAR_DOWNLOAD_URL})`,
        "2. Move it into Applications and open it",
        "3. Reopen this command — it will offer to finish setting up the CodexBar CLI",
      ];
  const cliRoute = hasHomebrew
    ? ["```", HOMEBREW_CLI_ONLY_COMMAND, "```"]
    : [
        `Download the \`${releaseArchive}\` archive from [GitHub Releases](${CODEXBAR_RELEASES_URL}) and`,
        "extract the `codexbar` binary into a folder on your `PATH`.",
      ];

  return [
    "# Install CodexBar CLI",
    "",
    "This extension reads your usage through the CodexBar CLI, which wasn't found on this Mac.",
    "There are two ways to get it:",
    "",
    "## CodexBar app + CLI (recommended)",
    "",
    "The CodexBar app is a menu-bar app that includes the CodexBar CLI and keeps it updated.",
    "",
    ...appRoute,
    "",
    "## CodexBar CLI only",
    "",
    ...cliRoute,
    "",
    hasHomebrew
      ? "When the install finishes, press **Retry**."
      : "Tip: with [Homebrew](https://brew.sh) installed, either route becomes a single command. When you're done, press **Retry**.",
  ].join("\n");
}

function isExecutableFile(path: string): Promise<boolean> {
  return access(path, constants.X_OK)
    .then(() => true)
    .catch(() => false);
}

// Follows symlinks, like FileManager.fileExists(atPath:) — a dangling link reads as absent.
async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isWritable(path: string): Promise<boolean> {
  return access(path, constants.W_OK)
    .then(() => true)
    .catch(() => false);
}

// Upstream's `isLink(atPath:pointingTo:)`: readlink, resolve relative to the link's dir, compare.
async function isLinkTo(linkPath: string, destination: string): Promise<boolean> {
  let target: string;
  try {
    target = await readlink(linkPath);
  } catch {
    return false;
  }

  return resolve(dirname(linkPath), target) === destination;
}
