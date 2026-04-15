import { Action, ActionPanel, Detail, Icon } from "@raycast/api";

type CommandErrorDetailProps = {
  title: string;
  error: Error;
  onRetry?: () => void;
};

export function CommandErrorDetail({ title, error, onRetry }: CommandErrorDetailProps) {
  return (
    <Detail
      markdown={[`# ${title}`, "", error.message || "Unknown error"].join("\n")}
      actions={
        <ActionPanel>
          {onRetry ? <Action title="Retry" icon={Icon.ArrowClockwise} onAction={onRetry} /> : null}
        </ActionPanel>
      }
    />
  );
}
