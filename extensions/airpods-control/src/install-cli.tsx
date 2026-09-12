import { Action, ActionPanel, Detail, Icon } from "@raycast/api";
import { useState } from "react";
import { InstallCliView } from "./components/install-cli-view";
import { findCliPath } from "./core/cli";
import { CLI_REPO_URL } from "./core/consts";

export default function Command() {
  const [cliPath, setCliPath] = useState(findCliPath);

  if (!cliPath) {
    return <InstallCliView onRetry={() => setCliPath(findCliPath())} />;
  }

  const markdown = `
# AirPods Control CLI Detected

The [airpods-control](${CLI_REPO_URL}) CLI executable was detected at:

\`\`\`
${cliPath}
\`\`\`

Detection confirms that the executable exists. Available commands still depend on your AirPods, firmware, macOS version, and CLI compatibility.
`;

  return (
    <Detail
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action title="Recheck" icon={Icon.ArrowClockwise} onAction={() => setCliPath(findCliPath())} />
          <Action.OpenInBrowser title="Open Airpods-Control on GitHub" url={CLI_REPO_URL} />
          <Action.CopyToClipboard title="Copy CLI Path" content={cliPath} />
        </ActionPanel>
      }
    />
  );
}
