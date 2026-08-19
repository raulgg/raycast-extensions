import { Action, ActionPanel, confirmAlert, Detail, Icon, showToast, Toast } from "@raycast/api";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { codexBarAppPathForHelper, installCodexBarCli } from "../lib/cliInstall";
import type { KeychainAccessPolicy } from "../lib/keychainAccessPolicy";
import {
  CodexBarCliError,
  resolveCodexBarBinary,
  smokeTestCodexBar,
  type InstallHelpState,
  type ResolvedCodexBarBinary,
} from "../lib/codexbar";
import { getKeychainAccessPolicy } from "../preferences";

type InstallHelpDetailProps = {
  install: InstallHelpState;
  onRetry: () => void;
};

export function InstallHelpDetail({ install, onRetry }: InstallHelpDetailProps) {
  return install.kind === "cli-missing" ? (
    <CliMissingDetail install={install} onRetry={onRetry} />
  ) : (
    <AppMissingDetail install={install} onRetry={onRetry} />
  );
}

type AppMissingDetailProps = {
  install: Extract<InstallHelpState, { kind: "app-missing" }>;
  onRetry: () => void;
};

function AppMissingDetail({ install, onRetry }: AppMissingDetailProps) {
  return (
    <Detail
      navigationTitle={install.title}
      markdown={install.markdown}
      actions={
        <ActionPanel>
          <Action title="Retry" icon={Icon.ArrowClockwise} onAction={onRetry} />
          {install.homebrewCommands ? (
            <Action.CopyToClipboard
              title="Copy App + CLI Install Command"
              content={install.homebrewCommands.appAndCli}
              icon={Icon.Clipboard}
            />
          ) : null}
          {install.homebrewCommands ? (
            <Action.CopyToClipboard
              title="Copy CLI-Only Install Command"
              content={install.homebrewCommands.cliOnly}
              icon={Icon.Clipboard}
            />
          ) : null}
          {installHelpLinkActions(install)}
        </ActionPanel>
      }
    />
  );
}

// Shown after a failed setup: the in-app steps become the lead option. Paths
// stay out of the copy — they live only in the Copy Details payload.
const CLI_SETUP_FAILED_MARKDOWN = [
  "# CodexBar CLI not set up",
  "",
  "Setting up the CodexBar CLI from here didn't work. Use the steps in the app instead:",
  "",
  "1. Open CodexBar",
  "2. Settings → Advanced",
  "3. Click Install CLI",
  "4. Return here and press Retry",
  "",
  "**Copy Details** copies what happened during the attempt — useful for a bug report.",
].join("\n");

type CliSetupVerdict = { ok: true } | { ok: false; details: string };

// Setup success is the availability gate — resolve plus the `--version` smoke
// test — never the status line: a just-linked helper can be resolvable yet
// unlaunchable. Capability detection is skipped; it never gates availability.
// Launch failures join the Copy Details payload (ADR-0008).
export async function judgeCliSetup(
  statusLine: string,
  keychainAccessPolicy: KeychainAccessPolicy,
): Promise<CliSetupVerdict> {
  let binary: ResolvedCodexBarBinary;
  try {
    binary = await resolveCodexBarBinary(keychainAccessPolicy);
  } catch {
    return { ok: false, details: statusLine };
  }

  try {
    await smokeTestCodexBar(binary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = error instanceof CodexBarCliError ? error.detail : undefined;
    return { ok: false, details: [statusLine, `Launch failed: ${message}`, ...(detail ? [detail] : [])].join("\n") };
  }

  return { ok: true };
}

type CliMissingDetailProps = {
  install: Extract<InstallHelpState, { kind: "cli-missing" }>;
  onRetry: () => void;
};

function CliMissingDetail({ install, onRetry }: CliMissingDetailProps) {
  const [failedSetupDetails, setFailedSetupDetails] = useState<string>();
  const { helperPath } = install;

  const setUpCli = useCallback(async () => {
    // Confirm before writing anything, phrased without filesystem paths.
    const confirmed = await confirmAlert({
      title: "Set Up the CodexBar CLI?",
      message:
        "This links the CodexBar CLI included in the CodexBar app so this extension can run it. Nothing is downloaded, no password is needed, and existing files are never replaced.",
      primaryAction: { title: "Set Up" },
    });
    if (!confirmed) {
      return;
    }

    const toast = await showToast({ style: Toast.Style.Animated, title: "Setting up the CodexBar CLI…" });
    const result = await installCodexBarCli(helperPath);
    const verdict = await judgeCliSetup(result.statusLine, getKeychainAccessPolicy());
    if (!verdict.ok) {
      toast.style = Toast.Style.Failure;
      toast.title = "Couldn't set up the CodexBar CLI";
      toast.message = "Use the steps in the app instead";
      setFailedSetupDetails(verdict.details);
      return;
    }

    toast.style = Toast.Style.Success;
    toast.title = "CodexBar CLI set up";
    // The availability hook keeps previous data, so this revalidate is what
    // swaps the view for the usage list.
    onRetry();
  }, [helperPath, onRetry]);

  const setUpAction = (
    // eslint-disable-next-line @raycast/prefer-title-case -- "Set Up" is a phrasal verb, like "Move Up" in moveProviderActions.
    <Action title="Set Up CodexBar CLI" icon={Icon.Link} onAction={() => void setUpCli()} />
  );

  // A failed setup demotes it below the in-app steps rather than dropping it.
  const setupFailed = failedSetupDetails !== undefined;

  return (
    <Detail
      navigationTitle={install.title}
      markdown={setupFailed ? CLI_SETUP_FAILED_MARKDOWN : install.markdown}
      actions={
        <ActionPanel>
          {setupFailed ? null : setUpAction}
          <Action.Open title="Open CodexBar" target={codexBarAppPathForHelper(helperPath)} icon={Icon.AppWindow} />
          <Action title="Retry" icon={Icon.ArrowClockwise} onAction={onRetry} />
          {setupFailed ? (
            <Action.CopyToClipboard title="Copy Details" content={failedSetupDetails} icon={Icon.Clipboard} />
          ) : null}
          {setupFailed ? setUpAction : null}
          {installHelpLinkActions(install)}
        </ActionPanel>
      }
    />
  );
}

// Array (not a fragment) so the actions inline into ActionPanel in stable order.
function installHelpLinkActions(install: InstallHelpState): ReactNode[] {
  return [
    <Action.OpenInBrowser key="docs" title="Open CLI Docs" url={install.docsUrl} icon={Icon.Book} />,
    <Action.OpenInBrowser key="releases" title="Open Releases" url={install.releasesUrl} icon={Icon.Download} />,
    <Action.OpenInBrowser key="repository" title="Open Repository" url={install.repositoryUrl} icon={Icon.Code} />,
  ];
}
