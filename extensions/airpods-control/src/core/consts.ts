import type { ListeningModes } from "./types";

export const CYCLE_MODE_ORDER: ListeningModes[] = ["off", "transparency", "adaptive", "anc"];

export const CLI_SEARCH_PATHS = ["/opt/homebrew/bin/airpods-control", "/usr/local/bin/airpods-control"];

export const CLI_BREW_FORMULA = "raulgg/tap/airpods-control";

export const CLI_VERSION = "v0.4.0";

export const CLI_INSTALL_COMMAND = `brew install ${CLI_BREW_FORMULA}`;

export const CLI_UPDATE_COMMAND = `brew upgrade ${CLI_BREW_FORMULA}`;

export const CLI_MANUAL_UPDATE_COMMAND = `brew update\n${CLI_UPDATE_COMMAND}`;

export const CLI_SOURCE_INSTALL_COMMAND = [
  `base=https://raw.githubusercontent.com/raulgg/airpods-control/${CLI_VERSION}`,
  `curl -fsSL "$base/scripts/install-from-source.sh" | sh -s --`,
].join("\n");

export const BREW_SEARCH_PATHS = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];

export const HOMEBREW_URL = "https://brew.sh";

export const HOMEBREW_INSTALL_COMMAND =
  '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';

export const DEVELOPER_TOOLS_INSTALL_COMMAND = "xcode-select --install";
export const DEVELOPER_TOOLS_DOCS_URL =
  "https://developer.apple.com/documentation/xcode/installing-the-command-line-tools/";
export const DEVELOPER_TOOLS_DOWNLOAD_URL = "https://developer.apple.com/download/all/";
export const CLI_SETUP_COMMAND_NAME = "update-airpods-control-cli";
export const CLI_LINK_COMMAND = `brew link ${CLI_BREW_FORMULA}`;

export const CLI_REPO_URL = "https://github.com/raulgg/airpods-control";

export const CLI_INSTALL_DOCS_URL = `${CLI_REPO_URL}/blob/${CLI_VERSION}/README.md#install`;

export const CYCLE_LISTENING_MODE_COMMAND_NAME = "cycle-listening-mode";

export const TOGGLE_CONVERSATION_AWARENESS_COMMAND_NAME = "toggle-conversation-awareness";
