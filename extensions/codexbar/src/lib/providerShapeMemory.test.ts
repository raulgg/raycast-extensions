import { Cache } from "@raycast/api";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProviderDetailData } from "../providers/types";
import {
  applyProviderUsageSectionMemory,
  pruneProviderUsageSectionMemory,
  SECTION_MEMORY_TTL_MS,
} from "./providerShapeMemory";

function makeDetail(includeSupplemental: boolean): ProviderDetailData {
  return {
    id: "claude",
    name: "Claude",
    fetchedAt: "2026-04-15T12:00:00Z",
    source: "oauth",
    accountEmail: "person@example.com",
    sections: [
      { kind: "usage", title: "Primary", displayTitle: "Session", remainingPercent: 75 },
      ...(includeSupplemental
        ? [{ kind: "supplementalUsage" as const, title: "Fable only", remainingPercent: 50 }]
        : []),
    ],
  };
}

describe("provider usage section memory", () => {
  beforeEach(() => {
    new Cache({ namespace: "provider-shape-memory" }).clear();
  });

  it("never restores account-derived shape memory across Keychain policies", () => {
    const now = Date.parse("2026-04-15T12:00:00Z");
    applyProviderUsageSectionMemory(makeDetail(true), "default", now);

    expect(applyProviderUsageSectionMemory(makeDetail(false), "disabled", now + 1).sections).toHaveLength(1);
    expect(applyProviderUsageSectionMemory(makeDetail(false), "default", now + 1).sections).toHaveLength(2);
  });

  it("physically removes expired memory in both policy scopes", () => {
    const cache = new Cache({ namespace: "provider-shape-memory" });
    const now = Date.parse("2026-04-15T12:00:00Z");
    applyProviderUsageSectionMemory(makeDetail(true), "default", now);
    applyProviderUsageSectionMemory(makeDetail(true), "disabled", now);

    pruneProviderUsageSectionMemory([], now + SECTION_MEMORY_TTL_MS + 1);

    expect(cache.get("usage-sections-v2:default:claude")).toBeUndefined();
    expect(cache.get("usage-sections-v2:disabled:claude")).toBeUndefined();
    expect(cache.get("usage-sections-v2:index")).toBeUndefined();
  });
});
