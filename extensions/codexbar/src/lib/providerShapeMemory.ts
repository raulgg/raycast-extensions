import { Cache } from "@raycast/api";
import type { ProviderDetailData, ProviderSupplementalUsageSection } from "../providers/types";

// Per-provider section memory (ADR-0007): upstream fetches sometimes drop
// supplemental sections, so we restore remembered ones until they age out
const SHAPE_MEMORY_SCHEMA_VERSION = "usage-sections-v1";

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

function buildShapeMemoryKey(providerId: string): string {
  return `${SHAPE_MEMORY_SCHEMA_VERSION}:${providerId}`;
}

// Sections must never be restored across a different account or resolved
// source: that would render one identity's meters under another's header.
function buildMemoryIdentity(detail: ProviderDetailData): string {
  return `${detail.source ?? ""}:${detail.accountEmail ?? ""}`;
}

function readRememberedSections(providerId: string, identity: string): RememberedSection[] {
  const serialized = getShapeMemoryCache().get(buildShapeMemoryKey(providerId));
  if (!serialized) {
    return [];
  }

  try {
    const parsed = JSON.parse(serialized) as SectionMemoryStore;
    return parsed.identity === identity && Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

/** Track which supplemental usage sections appear in detail, and restore any recently seen ones it dropped. */
export function applyProviderUsageSectionMemory(detail: ProviderDetailData, now = Date.now()): ProviderDetailData {
  const identity = buildMemoryIdentity(detail);
  const remembered = readRememberedSections(detail.id, identity).filter(
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
  getShapeMemoryCache().set(buildShapeMemoryKey(detail.id), JSON.stringify(store));

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
