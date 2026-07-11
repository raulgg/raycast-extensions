import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getProviderMetadata, isKnownProviderId, isProviderSelectorId, resolveProviderId } from "../providers/registry";
import type { AvailableProvider, ConfiguredProvider, ProviderSourceMode } from "../providers/types";
import { getMockAvailableProviders, isCodexBarMockMode } from "../mocks/codexbar";
import { CodexBarCliError, executeCodexBar, type ResolvedCodexBarBinary } from "./codexbar";

// Shared CodexBar config (~/.codexbar/config.json) + CLI roster helpers.
// See ADR-0001 (reorder) and ADR-0004 (mixed write ownership).
const CONFIG_PATH = join(homedir(), ".codexbar", "config.json");

type CodexBarConfig = {
  providers?: CodexBarConfigProvider[] | Record<string, CodexBarConfigProvider>;
};

type CodexBarConfigProvider = {
  id?: string;
  enabled?: boolean;
  source?: string;
};

// Entry from `codexbar config providers --json`.
type CodexBarConfigProvidersEntry = {
  provider?: string;
  displayName?: string;
  enabled?: boolean;
};

export type ProviderMoveDirection = "up" | "down";

export async function readConfiguredProvidersFromConfig(): Promise<ConfiguredProvider[]> {
  try {
    const rawConfig = await readFile(CONFIG_PATH, "utf8");
    return extractConfiguredProvidersFromConfig(rawConfig);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      throw new Error(`CodexBar config was not found at ${CONFIG_PATH}.`);
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse CodexBar config at ${CONFIG_PATH}.`);
    }

    if (error instanceof Error) {
      throw new Error(`Failed to read CodexBar config at ${CONFIG_PATH}: ${error.message}`);
    }

    throw new Error(`Failed to read CodexBar config at ${CONFIG_PATH}.`);
  }
}

// CLI `config providers` + registry join. Throws for old CLIs (callers degrade).
export async function listAvailableProviders(binary: ResolvedCodexBarBinary): Promise<AvailableProvider[]> {
  if (binary.source === "mock" || isCodexBarMockMode()) {
    return getMockAvailableProviders();
  }

  const payload = await executeCodexBar(binary, ["config", "providers", "--format", "json", "--json-only"]);
  const providers = normalizeAvailableProviders(payload);
  return orderEnabledProvidersByConfig(providers, await readConfiguredProviderOrder());
}

// Best-effort; falls back to CLI order on read failure.
async function readConfiguredProviderOrder(): Promise<string[]> {
  try {
    const configured = await readConfiguredProvidersFromConfig();
    return configured.map((provider) => provider.id);
  } catch {
    return [];
  }
}

// Reorders enabled to match config-file order; disabled trail in original order.
export function orderEnabledProvidersByConfig(
  providers: AvailableProvider[],
  enabledOrder: string[],
): AvailableProvider[] {
  const orderIndex = new Map(enabledOrder.map((id, index) => [id, index]));
  const enabled = providers.filter((provider) => provider.enabled);
  const disabled = providers.filter((provider) => !provider.enabled);

  const orderedEnabled = [...enabled].sort((a, b) => {
    const aIndex = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });

  return [...orderedEnabled, ...disabled];
}

export function normalizeAvailableProviders(payload: unknown): AvailableProvider[] {
  if (!Array.isArray(payload)) {
    throw new CodexBarCliError("invalid-json", "CodexBar returned unexpected output for `config providers`.");
  }

  const seenProviderIds = new Set<string>();
  const providers: AvailableProvider[] = [];

  for (const entry of payload) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as CodexBarConfigProvidersEntry;
    const cliProvider = typeof record.provider === "string" ? record.provider.trim() : "";
    if (!cliProvider || isProviderSelectorId(cliProvider)) {
      continue;
    }

    const canonicalId = resolveProviderId(cliProvider);
    if (seenProviderIds.has(canonicalId)) {
      continue;
    }
    seenProviderIds.add(canonicalId);

    const metadata = getProviderMetadata(cliProvider);
    const cliDisplayName =
      typeof record.displayName === "string" && record.displayName.trim() ? record.displayName.trim() : undefined;

    providers.push({
      id: metadata.id,
      cliProvider,
      name: isKnownProviderId(cliProvider) ? metadata.name : (cliDisplayName ?? metadata.name),
      icon: metadata.icon,
      enabled: record.enabled === true,
      supported: isKnownProviderId(cliProvider),
    });
  }

  return providers;
}

// CLI enable/disable. Does not affect order (CLI keeps array stable).
export async function setProviderEnabled(
  binary: ResolvedCodexBarBinary,
  cliProvider: string,
  enabled: boolean,
): Promise<void> {
  const normalizedProvider = cliProvider.trim();
  if (!normalizedProvider) {
    throw new CodexBarCliError("execution", "Cannot toggle a provider without an id.");
  }

  if (binary.source === "mock" || isCodexBarMockMode()) {
    return;
  }

  await executeCodexBar(binary, [
    "config",
    enabled ? "enable" : "disable",
    "--provider",
    normalizedProvider,
    "--format",
    "json",
    "--json-only",
  ]);
}

export async function moveConfiguredProviderInConfig(
  providerId: string,
  direction: ProviderMoveDirection,
): Promise<boolean> {
  try {
    const rawConfig = await readFile(CONFIG_PATH, "utf8");
    const updatedConfig = moveConfiguredProviderInRawConfig(rawConfig, providerId, direction);
    if (!updatedConfig) {
      return false;
    }

    await writeFile(CONFIG_PATH, updatedConfig, "utf8");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      throw new Error(`CodexBar config was not found at ${CONFIG_PATH}.`);
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse CodexBar config at ${CONFIG_PATH}.`);
    }

    if (error instanceof Error) {
      throw new Error(`Failed to update CodexBar config at ${CONFIG_PATH}: ${error.message}`);
    }

    throw new Error(`Failed to update CodexBar config at ${CONFIG_PATH}.`);
  }
}

export function moveConfiguredProviderInRawConfig(
  rawConfig: string,
  providerId: string,
  direction: ProviderMoveDirection,
): string | undefined {
  const parsedConfig = JSON.parse(rawConfig) as CodexBarConfig;
  const movedConfig = moveConfiguredProviderInParsedConfig(parsedConfig, providerId, direction);
  if (!movedConfig) {
    return undefined;
  }

  return `${JSON.stringify(movedConfig, null, 2)}\n`;
}

function extractConfiguredProvidersFromConfig(rawConfig: string): ConfiguredProvider[] {
  const parsedConfig = JSON.parse(rawConfig) as CodexBarConfig;
  const providers = normalizeConfiguredProviders(parsedConfig);

  const seenProviderIds = new Set<string>();

  return providers
    .filter(
      (provider): provider is CodexBarConfigProvider & { id: string; enabled: true } =>
        typeof provider.id === "string" && provider.id.trim().length > 0 && provider.enabled === true,
    )
    .map((provider) => ({ id: provider.id.trim(), source: normalizeProviderSource(provider.source) }))
    .filter(({ id }) => !isProviderSelectorId(id) && isKnownProviderId(id))
    .filter(({ id }) => {
      const canonicalId = resolveProviderId(id);
      if (seenProviderIds.has(canonicalId)) {
        return false;
      }

      seenProviderIds.add(canonicalId);
      return true;
    })
    .map(({ id: providerId, source }) => {
      const metadata = getProviderMetadata(providerId);
      return {
        id: metadata.id,
        name: metadata.name,
        icon: metadata.icon,
        keywords: [metadata.id],
        ...(source ? { source } : {}),
      };
    });
}

function normalizeProviderSource(source: unknown): ProviderSourceMode | undefined {
  if (source === "auto" || source === "web" || source === "cli" || source === "oauth" || source === "api") {
    return source;
  }

  return undefined;
}

function normalizeConfiguredProviders(config: CodexBarConfig): CodexBarConfigProvider[] {
  if (Array.isArray(config.providers)) {
    return config.providers;
  }

  if (!config.providers || typeof config.providers !== "object") {
    return [];
  }

  return Object.entries(config.providers).map(([providerId, provider]) => ({
    ...provider,
    id: typeof provider.id === "string" && provider.id.trim().length > 0 ? provider.id : providerId,
  }));
}

function moveConfiguredProviderInParsedConfig(
  config: CodexBarConfig,
  providerId: string,
  direction: ProviderMoveDirection,
): CodexBarConfig | undefined {
  const normalizedProviderId = providerId.trim();
  if (!normalizedProviderId) {
    return undefined;
  }

  if (Array.isArray(config.providers)) {
    const moveIndexes = findConfiguredProviderMoveIndexes(
      config.providers.map((provider) => ({ id: normalizeArrayProviderId(provider), provider })),
      normalizedProviderId,
      direction,
    );
    if (!moveIndexes) {
      return undefined;
    }

    return {
      ...config,
      providers: swapEntries(config.providers, moveIndexes.from, moveIndexes.to),
    };
  }

  if (!config.providers || typeof config.providers !== "object") {
    return undefined;
  }

  const providerEntries = Object.entries(config.providers);
  const moveIndexes = findConfiguredProviderMoveIndexes(
    providerEntries.map(([key, provider]) => ({
      id: normalizeObjectProviderId(key, provider),
      provider,
    })),
    normalizedProviderId,
    direction,
  );
  if (!moveIndexes) {
    return undefined;
  }

  return {
    ...config,
    providers: Object.fromEntries(swapEntries(providerEntries, moveIndexes.from, moveIndexes.to)),
  };
}

function findConfiguredProviderMoveIndexes(
  providers: Array<{ id?: string; provider?: CodexBarConfigProvider }>,
  providerId: string,
  direction: ProviderMoveDirection,
): { from: number; to: number } | undefined {
  const visibleProviders = providers.flatMap(({ id, provider }, index) => {
    if (!id || provider?.enabled !== true || isProviderSelectorId(id) || !isKnownProviderId(id)) {
      return [];
    }

    return [{ id, index }];
  });

  const currentVisibleIndex = visibleProviders.findIndex(
    (provider) => resolveProviderId(provider.id) === resolveProviderId(providerId),
  );
  if (currentVisibleIndex < 0) {
    return undefined;
  }

  const targetVisibleIndex = currentVisibleIndex + (direction === "up" ? -1 : 1);
  const targetProvider = visibleProviders[targetVisibleIndex];
  if (!targetProvider) {
    return undefined;
  }

  return {
    from: visibleProviders[currentVisibleIndex].index,
    to: targetProvider.index,
  };
}

function normalizeArrayProviderId(provider: CodexBarConfigProvider | undefined): string | undefined {
  return typeof provider?.id === "string" && provider.id.trim().length > 0 ? provider.id.trim() : undefined;
}

function normalizeObjectProviderId(providerId: string, provider: CodexBarConfigProvider | undefined): string {
  return typeof provider?.id === "string" && provider.id.trim().length > 0 ? provider.id.trim() : providerId;
}

function swapEntries<T>(entries: T[], from: number, to: number): T[] {
  const nextEntries = [...entries];
  const movedEntry = nextEntries[from];
  nextEntries[from] = nextEntries[to];
  nextEntries[to] = movedEntry;
  return nextEntries;
}
