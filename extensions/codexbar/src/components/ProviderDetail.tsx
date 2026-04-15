import { environment, List } from "@raycast/api";
import { buildProviderErrorMarkdown } from "../lib/presentation";
import { buildProviderDetailMarkdown } from "../providers/markdown";
import type { ConfiguredProvider, ProviderDetailData } from "../providers/types";

type ProviderDetailProps = {
  provider: ConfiguredProvider;
  detail?: ProviderDetailData;
  error?: Error;
  isLoading: boolean;
};

export function ProviderDetail({ provider, detail, error, isLoading }: ProviderDetailProps) {
  const detailMarkdown = detail ? buildProviderDetailMarkdown(detail, environment.appearance).trim() : undefined;
  const markdown = error
    ? buildProviderErrorMarkdown(provider.name, error, environment.appearance)
    : detailMarkdown
      ? detailMarkdown
      : isLoading
        ? "Loading..."
        : "No data available";

  return <List.Item.Detail isLoading={isLoading} markdown={markdown} />;
}
