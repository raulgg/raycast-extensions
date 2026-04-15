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
  const detailMarkdown = detail ? buildSafeProviderDetailMarkdown(detail) : undefined;
  const markdown = error
    ? buildProviderErrorMarkdown(provider.name, error, environment.appearance)
    : detailMarkdown
      ? detailMarkdown
      : isLoading
        ? "Loading..."
        : "No data available";

  return <List.Item.Detail isLoading={isLoading} markdown={markdown} />;
}

function buildSafeProviderDetailMarkdown(detail: ProviderDetailData): string | undefined {
  try {
    return buildProviderDetailMarkdown(detail, environment.appearance).trim();
  } catch (error) {
    if (isLegacySectionShapeError(error)) {
      return detail.markdown.trim() || undefined;
    }

    throw error;
  }
}

function isLegacySectionShapeError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Unsupported metric section kind: undefined");
}
