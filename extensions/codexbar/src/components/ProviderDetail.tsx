import { environment, List } from "@raycast/api";
import { buildProviderErrorMarkdown } from "../lib/presentation";
import { buildProviderDetailMarkdown, buildProviderLoadingMarkdown } from "../providers/markdown";
import type { ConfiguredProvider, ProviderDetailData } from "../providers/types";

type ProviderDetailProps = {
  provider: ConfiguredProvider;
  detail?: ProviderDetailData;
  error?: Error;
  isLoading: boolean;
};

export function ProviderDetail({ provider, detail, error, isLoading }: ProviderDetailProps) {
  const detailMarkdown = detail ? buildSafeProviderDetailMarkdown(detail, isLoading) : undefined;
  const markdown = error
    ? buildProviderErrorMarkdown(provider.name, error, environment.appearance)
    : detailMarkdown
      ? detailMarkdown
      : isLoading
        ? buildProviderLoadingMarkdown(provider, environment.appearance)
        : "No data available";

  return <List.Item.Detail isLoading={isLoading} markdown={markdown} />;
}

function buildSafeProviderDetailMarkdown(detail: ProviderDetailData, isLoading: boolean): string | undefined {
  try {
    return buildProviderDetailMarkdown(detail, environment.appearance, {
      subtitle: isLoading ? "Updating..." : undefined,
    }).trim();
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
