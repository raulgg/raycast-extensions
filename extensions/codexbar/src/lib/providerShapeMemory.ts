import { Cache } from "@raycast/api";
import type { ProviderDetailData, ProviderSupplementalUsageSection } from "../providers/types";
import type { KeychainAccessPolicy } from "./keychainAccessPolicy";

// Per-provider section memory (ADR-0007): upstream fetches sometimes drop
// supplemental sections, so we restore remembered ones until they age out
const SHAPE_MEMORY_SCHEMA_VERSION = "usage-sections-v2";
const LEGACY_SHAPE_MEMORY_SCHEMA_VERSION = "usage-sections-v1";
const SHAPE_MEMORY_INDEX_KEY = `${SHAPE_MEMORY_SCHEMA_VERSION}:index`;
const KEYCHAIN_ACCESS_POLICIES: KeychainAccessPolicy[] = ["default", "disabled"];

export const SECTION_MEMORY_TTL_MS = 24 * 60 * 60 * 1000;

type RememberedSection = {
  key: string;
  section: ProviderSupplementalUsageSection;
  index: number;
  lastSeenAt: number;
};

type SectionMemoryStore = {
  identity: string;
  entries: RememberedSection[];
};

// Lazy so importing this module never constructs a Cache — test setups that
// stub @raycast/api without a Cache export import codexbar.ts transitively.
let shapeMemoryCache: Cache | undefined;

function getShapeMemoryCache(): Cache {
  shapeMemoryCache ??= new Cache({ namespace: "provider-shape-memory" });
  return shapeMemoryCache;
}

function buildShapeMemoryKey(providerId: string, keychainAccessPolicy: KeychainAccessPolicy): string {
  return `${SHAPE_MEMORY_SCHEMA_VERSION}:${keychainAccessPolicy}:${providerId}`;
}

// Sections must never be restored across a different account or resolved
// source: that would render one identity's meters under another's header.
function buildMemoryIdentity(detail: ProviderDetailData): string {
  return `${detail.source ?? ""}:${detail.accountEmail ?? ""}`;
}

function readRememberedSections(
  providerId: string,
  identity: string,
  keychainAccessPolicy: KeychainAccessPolicy,
): RememberedSection[] {
  const key = buildShapeMemoryKey(providerId, keychainAccessPolicy);
  const serialized = getShapeMemoryCache().get(key);
  if (!serialized) {
    return [];
  }

  try {
    const parsed = JSON.parse(serialized) as SectionMemoryStore;
    if (typeof parsed.identity !== "string" || !Array.isArray(parsed.entries)) {
      throw new Error("invalid provider shape memory");
    }
    return parsed.identity === identity ? parsed.entries.filter(isRememberedSection) : [];
  } catch {
    getShapeMemoryCache().remove(key);
    untrackShapeMemoryIdIfEmpty(providerId);
    return [];
  }
}

/** Track which supplemental usage sections appear in detail, and restore any recently seen ones it dropped. */
export function applyProviderUsageSectionMemory(
  detail: ProviderDetailData,
  keychainAccessPolicy: KeychainAccessPolicy,
  now = Date.now(),
): ProviderDetailData {
  const identity = buildMemoryIdentity(detail);
  const remembered = readRememberedSections(detail.id, identity, keychainAccessPolicy).filter(
    (entry) => now - entry.lastSeenAt <= SECTION_MEMORY_TTL_MS,
  );

  const presentKeys = new Set<string>();
  const updated = new Map(remembered.map((entry) => [entry.key, entry] as const));
  detail.sections.forEach((section, index) => {
    // Only supplemental usage meters flake upstream; info sections carry
    // mutable inventory (credits, balances) that must never be resurrected.
    if (section.kind !== "supplementalUsage") {
      return;
    }

    presentKeys.add(section.title);
    updated.set(section.title, { key: section.title, section, index, lastSeenAt: now });
  });

  const store: SectionMemoryStore = { identity, entries: [...updated.values()] };
  const key = buildShapeMemoryKey(detail.id, keychainAccessPolicy);
  if (store.entries.length > 0) {
    getShapeMemoryCache().set(key, JSON.stringify(store));
    trackShapeMemoryId(detail.id);
  } else {
    getShapeMemoryCache().remove(key);
    untrackShapeMemoryIdIfEmpty(detail.id);
  }

  const missing = remembered
    .filter((entry) => !presentKeys.has(entry.key))
    .sort((left, right) => left.index - right.index);
  if (missing.length === 0) {
    return detail;
  }

  const sections = [...detail.sections];
  for (const entry of missing) {
    sections.splice(Math.min(entry.index, sections.length), 0, entry.section);
  }

  return { ...detail, sections };
}

export function pruneProviderUsageSectionMemory(providerIds: string[] = [], now = Date.now()): void {
  const trackedProviderIds = readShapeMemoryIndex();
  const providerIdsToPrune = new Set([...trackedProviderIds, ...providerIds]);

  for (const providerId of providerIdsToPrune) {
    getShapeMemoryCache().remove(`${LEGACY_SHAPE_MEMORY_SCHEMA_VERSION}:${providerId}`);

    for (const policy of KEYCHAIN_ACCESS_POLICIES) {
      const key = buildShapeMemoryKey(providerId, policy);
      const serialized = getShapeMemoryCache().get(key);
      if (!serialized) continue;

      try {
        const store = JSON.parse(serialized) as SectionMemoryStore;
        if (typeof store.identity !== "string" || !Array.isArray(store.entries)) {
          throw new Error("invalid provider shape memory");
        }
        const entries = store.entries.filter(
          (entry) => isRememberedSection(entry) && now - entry.lastSeenAt <= SECTION_MEMORY_TTL_MS,
        );
        if (entries.length === 0) {
          getShapeMemoryCache().remove(key);
        } else if (entries.length !== store.entries.length) {
          getShapeMemoryCache().set(key, JSON.stringify({ ...store, entries } satisfies SectionMemoryStore));
        }
      } catch {
        getShapeMemoryCache().remove(key);
      }
    }

    if (!hasAnyShapeMemoryEntry(providerId)) {
      trackedProviderIds.delete(providerId);
    }
  }

  writeShapeMemoryIndex(trackedProviderIds);
}

function isRememberedSection(entry: unknown): entry is RememberedSection {
  if (!entry || typeof entry !== "object") return false;
  const candidate = entry as Partial<RememberedSection>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.index === "number" &&
    Number.isInteger(candidate.index) &&
    typeof candidate.lastSeenAt === "number" &&
    Number.isFinite(candidate.lastSeenAt) &&
    candidate.section?.kind === "supplementalUsage"
  );
}

function trackShapeMemoryId(providerId: string): void {
  const providerIds = readShapeMemoryIndex();
  providerIds.add(providerId);
  writeShapeMemoryIndex(providerIds);
}

function untrackShapeMemoryIdIfEmpty(providerId: string): void {
  if (hasAnyShapeMemoryEntry(providerId)) return;
  const providerIds = readShapeMemoryIndex();
  providerIds.delete(providerId);
  writeShapeMemoryIndex(providerIds);
}

function hasAnyShapeMemoryEntry(providerId: string): boolean {
  return KEYCHAIN_ACCESS_POLICIES.some((policy) =>
    Boolean(getShapeMemoryCache().get(buildShapeMemoryKey(providerId, policy))),
  );
}

function readShapeMemoryIndex(): Set<string> {
  const serialized = getShapeMemoryCache().get(SHAPE_MEMORY_INDEX_KEY);
  if (!serialized) return new Set();

  try {
    const providerIds = JSON.parse(serialized) as unknown;
    if (!Array.isArray(providerIds) || !providerIds.every((providerId) => typeof providerId === "string")) {
      throw new Error("invalid provider shape memory index");
    }
    return new Set(providerIds);
  } catch {
    getShapeMemoryCache().remove(SHAPE_MEMORY_INDEX_KEY);
    return new Set();
  }
}

function writeShapeMemoryIndex(providerIds: Set<string>): void {
  if (providerIds.size === 0) {
    getShapeMemoryCache().remove(SHAPE_MEMORY_INDEX_KEY);
    return;
  }
  getShapeMemoryCache().set(SHAPE_MEMORY_INDEX_KEY, JSON.stringify([...providerIds]));
}
