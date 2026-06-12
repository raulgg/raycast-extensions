import { getMockConfiguredProviders, isCodexBarMockMode } from "../mocks/codexbar";
import type { ConfiguredProvider, ProviderDetailData } from "../providers/types";
import { cacheProviderDetailIfRicher, runProviderDetailFetches } from "../hooks/useProviderDetails";
import {
  ensureCodexBarServe,
  fetchProviderDetailFromServe,
  fetchProviderDetailFromUsageCommand,
  getCodexBarAvailability,
  readConfiguredProvidersFromConfig,
  type ResolvedCodexBarBinary,
} from "./codexbar";

const BACKGROUND_PROVIDER_DETAIL_CONCURRENCY = 4;

export type UsageCacheRefreshError = {
  providerId?: string;
  message: string;
};

export type UsageCacheRefreshResult =
  | {
      status: "completed";
      providerCount: number;
      refreshedCount: number;
      unchangedCount: number;
      errorCount: number;
      errors: UsageCacheRefreshError[];
      usedServe: boolean;
    }
  | {
      status: "skipped";
      reason: string;
      errors: UsageCacheRefreshError[];
    };

export async function refreshUsageCache(): Promise<UsageCacheRefreshResult> {
  const availability = await getCodexBarAvailability();
  if (availability.status !== "available") {
    return {
      status: "skipped",
      reason: availability.status === "unavailable" ? "codexbar-unavailable" : "codexbar-error",
      errors: [
        {
          message:
            availability.status === "unavailable"
              ? (availability.error?.message ?? "CodexBar CLI is unavailable.")
              : availability.error.message,
        },
      ],
    };
  }

  let providers: ConfiguredProvider[];
  try {
    providers = await readBackgroundConfiguredProviders(availability.binary);
  } catch (error) {
    return {
      status: "skipped",
      reason: "config-error",
      errors: [{ message: toErrorMessage(error) }],
    };
  }

  const providerIds = providers.map((provider) => provider.id).filter(Boolean);
  if (providerIds.length === 0) {
    return {
      status: "completed",
      providerCount: 0,
      refreshedCount: 0,
      unchangedCount: 0,
      errorCount: 0,
      errors: [],
      usedServe: false,
    };
  }

  const usedServe =
    availability.binary.source !== "mock" && !isCodexBarMockMode()
      ? await ensureCodexBarServe(availability.binary)
      : false;
  const errors: UsageCacheRefreshError[] = [];
  let refreshedCount = 0;
  let unchangedCount = 0;

  await runProviderDetailFetches({
    providerIds,
    concurrency: BACKGROUND_PROVIDER_DETAIL_CONCURRENCY,
    fetchProvider: async (providerId) => {
      try {
        const detail = await fetchProviderDetailForBackground(availability.binary, providerId, usedServe);
        if (cacheProviderDetailIfRicher(detail)) {
          refreshedCount += 1;
        } else {
          unchangedCount += 1;
        }
      } catch (error) {
        errors.push({ providerId, message: toErrorMessage(error) });
      }
    },
  });

  return {
    status: "completed",
    providerCount: providerIds.length,
    refreshedCount,
    unchangedCount,
    errorCount: errors.length,
    errors,
    usedServe,
  };
}

async function readBackgroundConfiguredProviders(binary: ResolvedCodexBarBinary): Promise<ConfiguredProvider[]> {
  if (binary.source === "mock" || isCodexBarMockMode()) {
    return getMockConfiguredProviders();
  }

  return readConfiguredProvidersFromConfig();
}

async function fetchProviderDetailForBackground(
  binary: ResolvedCodexBarBinary,
  providerId: string,
  preferServe: boolean,
): Promise<ProviderDetailData> {
  if (preferServe) {
    try {
      return await fetchProviderDetailFromServe(binary, providerId);
    } catch {
      return fetchProviderDetailFromUsageCommand(binary, providerId);
    }
  }

  return fetchProviderDetailFromUsageCommand(binary, providerId);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
