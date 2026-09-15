import { CLI_BREW_FORMULA } from "../homebrew/constants";

export const MIN_CLI_VERSION = "v0.4.0";

export const CLI_REPO_URL = "https://github.com/raulgg/airpods-control";

export const CLI_GITHUB_RELEASES_LATEST_URL = "https://api.github.com/repos/raulgg/airpods-control/releases/latest";

export const CLI_INSTALL_DOCS_URL = `${CLI_REPO_URL}/blob/HEAD/README.md#install`;

export const CLI_INSTALL_COMMAND = `brew install ${CLI_BREW_FORMULA}`;

export const CLI_UPDATE_COMMAND = `brew upgrade ${CLI_BREW_FORMULA}`;

export const CLI_MANUAL_UPDATE_COMMAND = `brew update\n${CLI_UPDATE_COMMAND}`;

export const CLI_SOURCE_INSTALL_COMMAND = [
  `tag=$(curl -fsSL -o /dev/null -w '%{url_effective}' ${CLI_REPO_URL}/releases/latest)`,
  `tag=\${tag##*/}`,
  `base=https://raw.githubusercontent.com/raulgg/airpods-control/$tag`,
  `curl -fsSL "$base/scripts/install-from-source.sh" | sh -s -- --version "$tag"`,
].join("\n");

export const HOMEBREW_INSTALL_COMMAND =
  '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';

export const DEVELOPER_TOOLS_INSTALL_COMMAND = "xcode-select --install";
export const DEVELOPER_TOOLS_DOCS_URL =
  "https://developer.apple.com/documentation/xcode/installing-the-command-line-tools";
export const CLI_LINK_COMMAND = `brew link ${CLI_BREW_FORMULA}`;
