import type { ListeningModes } from "./types";

export const CYCLE_MODE_ORDER: ListeningModes[] = ["off", "transparency", "adaptive", "anc"];

export const CLI_SEARCH_PATHS = ["/opt/homebrew/bin/airpods-control", "/usr/local/bin/airpods-control"];

export const CLI_BREW_FORMULA = "raulgg/tap/airpods-control";

export const CLI_INSTALL_COMMAND = `brew install ${CLI_BREW_FORMULA}`;

export const CLI_UPDATE_COMMAND = `brew upgrade ${CLI_BREW_FORMULA}`;

export const BREW_SEARCH_PATHS = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];

export const HOMEBREW_URL = "https://brew.sh";

export const CLI_REPO_URL = "https://github.com/raulgg/airpods-control";

export const CYCLE_LISTENING_MODE_COMMAND_NAME = "cycle-listening-mode";

export const TOGGLE_CONVERSATION_AWARENESS_COMMAND_NAME = "toggle-conversation-awareness";
