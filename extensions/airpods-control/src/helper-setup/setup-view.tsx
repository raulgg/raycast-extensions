import { Action, ActionPanel, Detail, Icon, Keyboard, openCommandPreferences } from "@raycast/api";
import { useEffect, useReducer } from "react";
import { getErrorMessage } from "../feedback/error-actions";
import { HOMEBREW_URL } from "../homebrew/constants";
import { CLI_INSTALL_DOCS_URL, CLI_REPO_URL, CLI_SOURCE_INSTALL_COMMAND } from "./constants";
import { detectCliSetup, setupNeedsUpdate } from "./detection";
import { runCliInstallation, type CliOperation } from "./installation";
import { cliSetupLifecycleReducer, INITIAL_LIFECYCLE } from "./lifecycle";
import { CliSetupActions, cliSetupMarkdown } from "./setup-content";

export default function Command() {
  const [lifecycle, dispatch] = useReducer(cliSetupLifecycleReducer, INITIAL_LIFECYCLE);

  useEffect(() => {
    if (lifecycle.status !== "checking") return;
    let active = true;
    void detectCliSetup()
      .then((setup) => {
        if (active) dispatch({ type: "ready", setup });
      })
      .catch((error: unknown) => {
        if (active) dispatch({ type: "failed", error: getErrorMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [lifecycle]);

  useEffect(() => {
    if (lifecycle.status !== "running") return;
    const { operation } = lifecycle;
    let active = true;
    void runCliInstallation(operation)
      .then((setup) => {
        if (active) dispatch({ type: "completed", setup });
      })
      .catch((error: unknown) => {
        if (active) dispatch({ type: "failed", error: getErrorMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [lifecycle]);

  function check() {
    dispatch({ type: "check" });
  }

  function run(operation: CliOperation) {
    dispatch({ type: "run", operation });
  }

  const isChecking = lifecycle.status === "checking";
  const operation = lifecycle.status === "running" ? lifecycle.operation : undefined;
  const setup = "setup" in lifecycle ? lifecycle.setup : undefined;
  const error = lifecycle.status === "failed" ? lifecycle.error : undefined;
  const completed = lifecycle.status === "completed";

  let markdown = setup ? cliSetupMarkdown(setup) : "# AirPods Control Helper\n\nChecking your installation…";
  if (operation) {
    markdown = `# ${operation === "install" ? "Installing" : "Updating"} helper…\n\nThis can take several minutes. Keep Raycast open until it finishes.`;
  } else if (error) {
    markdown = `# AirPods Control Helper needs attention\n\n${error
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n")}`;
  } else if (completed) {
    markdown = "# AirPods Control Helper is ready!";
  }
  const idle = !isChecking && !operation;
  const needsUpdate = setup ? setupNeedsUpdate(setup) : false;
  const availableOperation =
    setup?.state === "install" ? "install" : setup?.state === "update" && needsUpdate ? "update" : undefined;
  const canRun = idle && !error && !completed && availableOperation;
  const ready = idle && !error && !completed && setup;
  const showAlternatives = Boolean(ready && setup && ["install", "needs-homebrew"].includes(setup.state));
  const showHomebrewHelp = Boolean(ready && setup?.state === "needs-homebrew");
  const showInstallInstructions =
    idle && !completed && (setup?.state === "install" || setup?.state === "needs-homebrew" || Boolean(error && !setup));
  const showUpdateInstructions =
    idle && !completed && needsUpdate && (setup?.state === "update" || setup?.state === "manual-cli");
  const showSetupActions = Boolean(
    ready &&
    setup &&
    (!canRun || setup.state === "update") &&
    setup.state !== "installing" &&
    (setup.state === "update" || setup.state === "manual-cli" ? needsUpdate : true),
  );
  const showSetupSection = idle && (canRun || showSetupActions || error);

  return (
    <Detail
      markdown={markdown}
      isLoading={isChecking || !!operation}
      actions={
        <ActionPanel>
          {showSetupSection && (
            <ActionPanel.Section title="Setup">
              {canRun && (
                <Action
                  title={availableOperation === "install" ? "Install with Homebrew" : "Update with Homebrew"}
                  icon={Icon.Download}
                  onAction={() => run(availableOperation)}
                />
              )}
              {showSetupActions && setup && <CliSetupActions setup={setup} />}
              {error && <Action.CopyToClipboard title="Copy Error" content={error} />}
            </ActionPanel.Section>
          )}
          {showAlternatives && setup && (
            <ActionPanel.Section title="Alternative Methods">
              {canRun && <CliSetupActions setup={setup} />}
              <Action.CopyToClipboard title="Copy Source Install Command" content={CLI_SOURCE_INSTALL_COMMAND} />
            </ActionPanel.Section>
          )}
          {idle && (
            <ActionPanel.Section title="Help">
              {showHomebrewHelp && (
                <Action.OpenInBrowser
                  title="Open Homebrew Installation Instructions"
                  url={HOMEBREW_URL}
                  shortcut={Keyboard.Shortcut.Common.Open}
                />
              )}
              {showInstallInstructions && (
                <Action.OpenInBrowser
                  title="Open Installation Instructions"
                  url={CLI_INSTALL_DOCS_URL}
                  shortcut={showHomebrewHelp ? { modifiers: ["cmd", "opt"], key: "o" } : Keyboard.Shortcut.Common.Open}
                />
              )}
              {showUpdateInstructions && (
                <Action.OpenInBrowser
                  title="Open Update Instructions"
                  url={CLI_INSTALL_DOCS_URL}
                  shortcut={Keyboard.Shortcut.Common.Open}
                />
              )}
              <Action.OpenInBrowser
                title="Open AirPods Control on GitHub"
                url={CLI_REPO_URL}
                shortcut={Keyboard.Shortcut.Common.OpenWith}
              />
            </ActionPanel.Section>
          )}
          {idle && (
            <ActionPanel.Section title="Preferences">
              <Action title="Open Command Preferences" icon={Icon.Gear} onAction={openCommandPreferences} />
            </ActionPanel.Section>
          )}
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
