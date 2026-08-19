import { Cache } from "@raycast/api";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCachedProviderResults,
  cacheProviderDetail,
  recordProviderDetailFailure,
  recordProviderDetailSuccess,
  pruneProviderDetailCaches,
  runProviderDetailFetches,
  shouldRefreshProviderAutomatically,
  shouldRefreshSelectedProvider,
  shouldSurfaceProviderDetailFailure,
} from "./providerDetailCache";
import type { ProviderDetailData, ProviderSection } from "../providers/types";

function makeDetail(providerId: string, fetchedAt: string, sections?: ProviderSection[]): ProviderDetailData {
  return {
    id: providerId,
    name: providerId,
    fetchedAt,
    sections: sections ?? [
      {
        kind: "usage",
        title: "Primary",
        displayTitle: "Session",
        remainingPercent: 82,
      },
    ],
  };
}

describe("providerDetailCache", () => {
  beforeEach(() => {
    new Cache({ namespace: "provider-details" }).clear();
    new Cache({ namespace: "provider-detail-failures" }).clear();
  });

  it("caps concurrent provider fetches", async () => {
    let activeFetches = 0;
    let maxActiveFetches = 0;
    const fetchedProviders: string[] = [];

    await runProviderDetailFetches({
      providerIds: ["codex", "claude", "cursor", "gemini", "warp"],
      concurrency: 2,
      fetchProvider: async (providerId) => {
        activeFetches += 1;
        maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
        fetchedProviders.push(providerId);

        await Promise.resolve();
        activeFetches -= 1;
      },
    });

    expect(maxActiveFetches).toBe(2);
    expect(fetchedProviders).toEqual(["codex", "claude", "cursor", "gemini", "warp"]);
  });

  it("skips providers that no longer need a batch fetch", async () => {
    const fetchedProviders: string[] = [];

    await runProviderDetailFetches({
      providerIds: ["codex", "claude", "cursor"],
      concurrency: 4,
      shouldSkip: (providerId) => providerId === "claude",
      fetchProvider: async (providerId) => {
        fetchedProviders.push(providerId);
      },
    });

    expect(fetchedProviders).toEqual(["codex", "cursor"]);
  });

  it("hydrates provider results from fresh cached details", () => {
    const now = Date.parse("2026-04-15T12:05:00Z");
    cacheProviderDetail(makeDetail("codex", "2026-04-15T12:00:00Z"), "default");

    expect(buildCachedProviderResults(["codex"], "default", now)).toMatchObject({
      codex: {
        detail: { id: "codex", sections: [{ kind: "usage", remainingPercent: 82 }] },
        cacheStatus: "fresh",
        isLoading: false,
      },
    });
  });

  it("hydrates stale cached provider details up to one hour old", () => {
    const now = Date.parse("2026-04-15T12:10:01Z");
    cacheProviderDetail(makeDetail("claude", "2026-04-15T12:00:00Z"), "default");

    expect(buildCachedProviderResults(["claude"], "default", now)).toMatchObject({
      claude: {
        detail: { id: "claude", sections: [{ kind: "usage", remainingPercent: 82 }] },
        cacheStatus: "stale",
        isLoading: false,
      },
    });
  });

  it("ignores cached provider details older than one hour", () => {
    const now = Date.parse("2026-04-15T13:00:01Z");
    cacheProviderDetail(makeDetail("cursor", "2026-04-15T12:00:00Z"), "default");

    expect(buildCachedProviderResults(["cursor"], "default", now)).toEqual({});
  });

  it("refreshes selected providers when detail is older than ten minutes", () => {
    const now = Date.parse("2026-04-15T12:10:01Z");

    expect(
      shouldRefreshSelectedProvider(
        {
          detail: makeDetail("codex", "2026-04-15T12:00:00Z"),
          isLoading: false,
        },
        1,
        1,
        now,
      ),
    ).toBe(true);
  });

  it("keeps selected provider data when detail is ten minutes old or newer", () => {
    const now = Date.parse("2026-04-15T12:10:00Z");

    expect(
      shouldRefreshSelectedProvider(
        {
          detail: makeDetail("codex", "2026-04-15T12:00:00Z"),
          isLoading: false,
        },
        1,
        1,
        now,
      ),
    ).toBe(false);
  });

  it("fetches selected providers with no data unless current generation already completed", () => {
    expect(shouldRefreshSelectedProvider(undefined, undefined, 1)).toBe(true);
    expect(shouldRefreshSelectedProvider(undefined, 1, 1)).toBe(false);
  });

  it("uses the same ten-minute threshold for automatic foreground refreshes", () => {
    const freshNow = Date.parse("2026-04-15T12:10:00Z");
    const staleNow = Date.parse("2026-04-15T12:10:01Z");
    const result = {
      detail: makeDetail("claude", "2026-04-15T12:00:00Z"),
      isLoading: false,
    };

    expect(shouldRefreshProviderAutomatically(result, undefined, 1, freshNow)).toBe(false);
    expect(shouldRefreshProviderAutomatically(result, undefined, 1, staleNow)).toBe(true);
  });

  it("treats every successful detail response as authoritative", () => {
    const richDetail = makeDetail("claude", "2026-04-15T12:00:00Z", [
      {
        kind: "usage",
        title: "Primary",
        displayTitle: "Session",
        remainingPercent: 82,
        resetsIn: "2h",
      },
      {
        kind: "usage",
        title: "Secondary",
        displayTitle: "Weekly",
        remainingPercent: 76,
        resetsIn: "4d",
      },
      {
        kind: "supplementalUsage",
        title: "Model",
        remainingPercent: 91,
        resetsIn: "4d",
      },
    ]);
    const poorDetail = makeDetail("claude", "2026-04-15T12:01:00Z", [
      {
        kind: "usage",
        title: "Primary",
        displayTitle: "Session",
        remainingPercent: 82,
      },
      {
        kind: "usage",
        title: "Secondary",
        displayTitle: "Weekly",
        remainingPercent: 76,
      },
    ]);

    cacheProviderDetail(richDetail, "default");
    cacheProviderDetail(poorDetail, "default");
    expect(buildCachedProviderResults(["claude"], "default", Date.parse("2026-04-15T12:02:00Z"))).toMatchObject({
      claude: {
        detail: {
          sections: [
            { kind: "usage", title: "Primary" },
            { kind: "usage", title: "Secondary" },
          ],
        },
      },
    });
  });

  it("accepts poorer refreshes when an existing usage value changed", () => {
    const richDetail = makeDetail("claude", "2026-04-15T12:00:00Z", [
      {
        kind: "usage",
        title: "Primary",
        displayTitle: "Session",
        remainingPercent: 82,
        resetsIn: "2h",
      },
      {
        kind: "supplementalUsage",
        title: "Model",
        remainingPercent: 91,
        resetsIn: "4d",
      },
    ]);
    const newerUsageDetail = makeDetail("claude", "2026-04-15T12:01:00Z", [
      {
        kind: "usage",
        title: "Primary",
        displayTitle: "Session",
        remainingPercent: 55,
      },
    ]);

    cacheProviderDetail(richDetail, "default");
    cacheProviderDetail(newerUsageDetail, "default");
    expect(buildCachedProviderResults(["claude"], "default", Date.parse("2026-04-15T12:02:00Z"))).toMatchObject({
      claude: { detail: { sections: [{ remainingPercent: 55 }] } },
    });
  });

  it("accepts equal or richer refreshes for any provider", () => {
    const currentDetail = makeDetail("codex", "2026-04-15T12:00:00Z", [
      {
        kind: "usage",
        title: "Primary",
        displayTitle: "Session",
        remainingPercent: 82,
      },
    ]);
    const richerDetail = makeDetail("codex", "2026-04-15T12:01:00Z", [
      {
        kind: "usage",
        title: "Primary",
        displayTitle: "Session",
        remainingPercent: 82,
        resetsIn: "2h",
      },
      {
        kind: "usage",
        title: "Secondary",
        displayTitle: "Weekly",
        remainingPercent: 76,
      },
    ]);

    cacheProviderDetail(currentDetail, "default");
    cacheProviderDetail(richerDetail, "default");
    expect(buildCachedProviderResults(["codex"], "default", Date.parse("2026-04-15T12:02:00Z"))).toMatchObject({
      codex: {
        detail: {
          sections: [
            { kind: "usage", title: "Primary" },
            { kind: "usage", title: "Secondary" },
          ],
        },
      },
    });
  });

  it("replaces richer cached details with a successful authoritative background refresh", () => {
    const now = Date.parse("2026-04-15T12:02:00Z");
    const richDetail = makeDetail("codex", "2026-04-15T12:00:00Z", [
      {
        kind: "usage",
        title: "Primary",
        displayTitle: "Session",
        remainingPercent: 82,
        resetsIn: "2h",
      },
      {
        kind: "supplementalUsage",
        title: "Codex Spark",
        remainingPercent: 100,
        resetsIn: "5h",
      },
    ]);
    const poorDetail = makeDetail("codex", "2026-04-15T12:01:00Z", [
      {
        kind: "usage",
        title: "Primary",
        displayTitle: "Session",
        remainingPercent: 82,
      },
    ]);

    cacheProviderDetail(richDetail, "default");

    cacheProviderDetail(poorDetail, "default");
    expect(buildCachedProviderResults(["codex"], "default", now)).toMatchObject({
      codex: {
        detail: {
          sections: [{ kind: "usage", title: "Primary" }],
        },
      },
    });
  });

  it("suppresses the first cached-data failure and surfaces the second", () => {
    expect(shouldSurfaceProviderDetailFailure(true, recordProviderDetailFailure("claude", "default"))).toBe(false);
    expect(shouldSurfaceProviderDetailFailure(true, recordProviderDetailFailure("claude", "default"))).toBe(true);

    recordProviderDetailSuccess("claude", "default");
    expect(shouldSurfaceProviderDetailFailure(true, recordProviderDetailFailure("claude", "default"))).toBe(false);
  });

  it("surfaces the first failure when no cached detail exists", () => {
    expect(shouldSurfaceProviderDetailFailure(false, recordProviderDetailFailure("codex", "default"))).toBe(true);
  });

  it("isolates cached details and failure counters by Keychain access policy", () => {
    const now = Date.parse("2026-04-15T12:05:00Z");
    cacheProviderDetail(makeDetail("codex", "2026-04-15T12:00:00Z"), "default");

    expect(buildCachedProviderResults(["codex"], "disabled", now)).toEqual({});
    expect(buildCachedProviderResults(["codex"], "default", now)).toHaveProperty("codex.detail.id", "codex");
    expect(recordProviderDetailFailure("codex", "default")).toBe(1);
    expect(recordProviderDetailFailure("codex", "disabled")).toBe(1);
  });

  it("physically removes expired details from both policy scopes", () => {
    const cache = new Cache({ namespace: "provider-details" });
    const fetchedAt = "2026-04-15T12:00:00Z";
    cacheProviderDetail(makeDetail("codex", fetchedAt), "default");
    cacheProviderDetail(makeDetail("codex", fetchedAt), "disabled");

    pruneProviderDetailCaches([], Date.parse("2026-04-15T13:00:01Z"));

    expect(buildCachedProviderResults(["codex"], "default", Date.parse("2026-04-15T13:00:01Z"))).toEqual({});
    expect(buildCachedProviderResults(["codex"], "disabled", Date.parse("2026-04-15T13:00:01Z"))).toEqual({});
    expect(cache.get("provider-details-v7:index")).toBeUndefined();
  });
});
