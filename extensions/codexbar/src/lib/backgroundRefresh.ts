import { getMockConfiguredProviders, isCodexBarMockMode } from "../mocks/codexbar";
import type { ConfiguredProvider } from "../providers/types";
import {
  cacheProviderDetail,
  recordProviderDetailFailure,
  recordProviderDetailSuccess,
  runProviderDetailFetches,
} from "./providerDetailCache";
import { cacheProviderStatus, readProviderStatus } from "./providerStatusCache";
import {
  ensureCodexBarServe,
  fetchProviderDetailFromServe,
  fetchProviderDetailFromUsageCommand,
  fetchProviderUsageWithStatus,
  getCodexBarAvailability,
  type ProviderUsageWithStatus,
  type ResolvedCodexBarBinary,
} from "./codexbar";
import { readConfiguredProvidersFromConfig } from "./providerConfig";

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
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
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
  const unchangedCount = 0;

  await runProviderDetailFetches({
    providerIds,
    concurrency: BACKGROUND_PROVIDER_DETAIL_CONCURRENCY,
    fetchProvider: async (providerId) => {
      const provider = providersById.get(providerId);
      if (!provider) return;
      try {
        const { detail, status } = await fetchProviderDetailAndStatusForBackground(
          availability.binary,
          provider,
          usedServe,
        );
        cacheProviderDetail(detail);
        recordProviderDetailSuccess(providerId);
        refreshedCount += 1;
        // Best effort only; never drop a prior cached status on miss.
        if (status) {
          cacheProviderStatus(providerId, status);
        }
      } catch (error) {
        recordProviderDetailFailure(providerId);
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

// Serve-preferred (ADR-0002) for detail; status is CLI-only (ADR-0003) and
// refreshed only when the dedicated status cache is empty or past TTL.
async function fetchProviderDetailAndStatusForBackground(
  binary: ResolvedCodexBarBinary,
  provider: ConfiguredProvider,
  preferServe: boolean,
): Promise<ProviderUsageWithStatus> {
  const options = { source: provider.source, interaction: "background" as const };
  if (preferServe) {
    try {
      const detail = await fetchProviderDetailFromServe(binary, provider.id, options);
      return attachStatusWhenStale(binary, provider, detail);
    } catch {
      return fetchProviderUsageWithStatusOrDetailOnly(binary, provider);
    }
  }

  return fetchProviderUsageWithStatusOrDetailOnly(binary, provider);
}

// Keep serve-sourced detail primary; a failed status one-shot must not drop it.
async function attachStatusWhenStale(
  binary: ResolvedCodexBarBinary,
  provider: ConfiguredProvider,
  detail: ProviderUsageWithStatus["detail"],
): Promise<ProviderUsageWithStatus> {
  if (readProviderStatus(provider.id)) {
    return { detail, status: undefined };
  }

  try {
    const { status } = await fetchProviderUsageWithStatus(binary, provider.id, {
      source: provider.source,
      interaction: "background",
    });
    return { detail, status };
  } catch {
    return { detail, status: undefined };
  }
}

// Combined --status may fail on old CLIs; fall back to plain detail so status errors never drop usage.
async function fetchProviderUsageWithStatusOrDetailOnly(
  binary: ResolvedCodexBarBinary,
  provider: ConfiguredProvider,
): Promise<ProviderUsageWithStatus> {
  try {
    return await fetchProviderUsageWithStatus(binary, provider.id, {
      source: provider.source,
      interaction: "background",
    });
  } catch {
    const detail = await fetchProviderDetailFromUsageCommand(binary, provider.id, {
      source: provider.source,
      interaction: "background",
    });
    return { detail, status: undefined };
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
