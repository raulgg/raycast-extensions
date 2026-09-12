import {
  Action,
  ActionPanel,
  Detail,
  Icon,
  Keyboard,
  openCommandPreferences,
  openExtensionPreferences,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { CliSetupActions, cliSetupMarkdown } from "./components/cli-setup-content";
import { runCliInstallation, type CliOperation } from "./core/cli-installation";
import { detectCliSetup, type CliSetup } from "./core/cli-setup";
import { CLI_INSTALL_DOCS_URL, CLI_REPO_URL, CLI_SOURCE_INSTALL_COMMAND, HOMEBREW_URL } from "./core/consts";
import { getErrorMessage } from "./core/toast-manager";

export default function Command() {
  const [setup, setSetup] = useState<CliSetup>();
  const [isChecking, setIsChecking] = useState(true);
  const [operation, setOperation] = useState<CliOperation>();
  const [error, setError] = useState<string>();
  const [completed, setCompleted] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(false);

  async function check() {
    if (busy.current) return;
    busy.current = true;
    setIsChecking(true);
    setError(undefined);
    setCompleted(false);
    try {
      const detected = await detectCliSetup();
      if (mounted.current) setSetup(detected);
    } catch (error) {
      if (mounted.current) {
        setSetup(undefined);
        setError(getErrorMessage(error));
      }
    } finally {
      busy.current = false;
      if (mounted.current) setIsChecking(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void check();
    return () => {
      mounted.current = false;
    };
  }, []);

  async function run(operation: CliOperation) {
    if (busy.current) return;
    busy.current = true;
    setOperation(operation);
    setCompleted(false);
    setError(undefined);
    try {
      const detected = await runCliInstallation(operation);
      if (mounted.current) {
        setSetup(detected);
        setCompleted(true);
      }
    } catch (error) {
      if (mounted.current) setError(getErrorMessage(error));
    } finally {
      busy.current = false;
      if (mounted.current) setOperation(undefined);
    }
  }

  let markdown = setup ? cliSetupMarkdown(setup) : "# AirPods Control Helper\n\nChecking your installation…";
  if (operation) {
    markdown = `# ${operation === "install" ? "Installing" : "Updating"} helper…\n\nThis can take several minutes. Keep Raycast open until it finishes.`;
  } else if (error) {
    markdown = `# Helper needs attention\n\nThe helper needs attention before you can continue. Follow the details below, then choose the **Refresh** action to check again. Installation instructions are available in the Action Panel.\n\n## Error details\n\n${error
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n")}`;
  } else if (completed) {
    markdown = "# Your helper is ready\n\nYou can now run your AirPods commands.";
  }
  const idle = !isChecking && !operation;
  const availableOperation = setup?.state === "install" || setup?.state === "update" ? setup.state : undefined;
  const canRun = idle && !error && !completed && availableOperation;
  const showAlternatives = idle && !error && !completed && setup && ["install", "needs-homebrew"].includes(setup.state);
  const showManualUpdate = idle && !error && !completed && setup?.state === "manual-cli";
  const showHomebrewHelp = setup?.brewPath === null;

  return (
    <Detail
      markdown={markdown}
      isLoading={isChecking || !!operation}
      actions={
        <ActionPanel>
          {idle && (
            <ActionPanel.Section title="Setup">
              {showManualUpdate && (
                <Action.OpenInBrowser
                  title="Open Update Instructions"
                  url={CLI_INSTALL_DOCS_URL}
                  shortcut={Keyboard.Shortcut.Common.Open}
                />
              )}
              {canRun && (
                <Action
                  title={availableOperation === "install" ? "Install with Homebrew" : "Update with Homebrew"}
                  icon={Icon.Download}
                  onAction={() => run(availableOperation)}
                />
              )}
              {(!canRun || setup?.state === "update") && !error && !completed && setup && (
                <CliSetupActions setup={setup} />
              )}
              {error && <Action.CopyToClipboard title="Copy Error" content={error} />}
            </ActionPanel.Section>
          )}
          {showAlternatives && (
            <ActionPanel.Section title="Alternative Methods">
              {canRun && <CliSetupActions setup={setup} />}
              <Action.CopyToClipboard title="Copy Source Install Command" content={CLI_SOURCE_INSTALL_COMMAND} />
            </ActionPanel.Section>
          )}
          <ActionPanel.Section title="Help">
            {showHomebrewHelp && (
              <Action.OpenInBrowser
                title="Open Homebrew Installation Instructions"
                url={HOMEBREW_URL}
                shortcut={showManualUpdate ? { modifiers: ["cmd", "opt"], key: "o" } : Keyboard.Shortcut.Common.Open}
              />
            )}
            {!showManualUpdate && (
              <Action.OpenInBrowser
                title={
                  setup?.state === "update" || setup?.state === "manual-cli"
                    ? "Open Update Instructions"
                    : "Open Installation Instructions"
                }
                url={CLI_INSTALL_DOCS_URL}
                shortcut={showHomebrewHelp ? { modifiers: ["cmd", "opt"], key: "o" } : Keyboard.Shortcut.Common.Open}
              />
            )}
            <Action.OpenInBrowser
              title="Open AirPods Control on GitHub"
              url={CLI_REPO_URL}
              shortcut={Keyboard.Shortcut.Common.OpenWith}
            />
          </ActionPanel.Section>
          <ActionPanel.Section title="Preferences">
            {idle && (error || setup?.state !== "invalid-cli-path") && (
              <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
            )}
            <Action title="Open Command Preferences" icon={Icon.Gear} onAction={openCommandPreferences} />
          </ActionPanel.Section>
          {idle && (
            <ActionPanel.Section>
              <Action
                title="Refresh"
                icon={Icon.ArrowClockwise}
                shortcut={Keyboard.Shortcut.Common.Refresh}
                onAction={check}
              />
            </ActionPanel.Section>
          )}
        </ActionPanel>
      }
    />
  );
}
