import { Cache } from "@raycast/api";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCachedProviderResults,
  canApplyProviderFetchResult,
  cacheProviderDetail,
  cacheProviderDetailIfRicher,
  preserveInFlightProviderResults,
  runProviderDetailFetches,
  shouldRefreshSelectedProvider,
  shouldReplaceProviderDetail,
  type InFlightProviderFetch,
} from "./useProviderDetails";
import type { ProviderDetailData, ProviderSection } from "../providers/types";

function makeDetail(providerId: string, fetchedAt: string, sections?: ProviderSection[]): ProviderDetailData {
  return {
    id: providerId,
    name: providerId,
    raw: {},
    fetchedAt,
    sections: sections ?? [
      {
        kind: "usage",
        title: "Primary",
        displayTitle: "Session",
        remainingPercent: 82,
      },
    ],
    markdown: `# ${providerId}`,
  };
}

describe("runProviderDetailFetches", () => {
  beforeEach(() => {
    new Cache({ namespace: "provider-details" }).clear();
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
    cacheProviderDetail(makeDetail("codex", "2026-04-15T12:00:00Z"));

    expect(buildCachedProviderResults(["codex"], now)).toMatchObject({
      codex: {
        detail: { id: "codex", sections: [{ kind: "usage", remainingPercent: 82 }] },
        cacheStatus: "fresh",
        isLoading: false,
      },
    });
  });

  it("hydrates stale cached provider details up to one hour old", () => {
    const now = Date.parse("2026-04-15T12:05:01Z");
    cacheProviderDetail(makeDetail("claude", "2026-04-15T12:00:00Z"));

    expect(buildCachedProviderResults(["claude"], now)).toMatchObject({
      claude: {
        detail: { id: "claude", sections: [{ kind: "usage", remainingPercent: 82 }] },
        cacheStatus: "stale",
        isLoading: false,
      },
    });
  });

  it("ignores cached provider details older than one hour", () => {
    const now = Date.parse("2026-04-15T13:00:01Z");
    cacheProviderDetail(makeDetail("cursor", "2026-04-15T12:00:00Z"));

    expect(buildCachedProviderResults(["cursor"], now)).toEqual({});
  });

  it("refreshes selected providers when detail is older than one minute", () => {
    const now = Date.parse("2026-04-15T12:01:01Z");

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

  it("keeps selected provider data when detail is one minute old or newer", () => {
    const now = Date.parse("2026-04-15T12:01:00Z");

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

  it("preserves in-flight provider state across batch resets", () => {
    const inFlightFetches = new Map<string, InFlightProviderFetch>([
      ["claude", { binaryKey: "path\0codexbar", fetchId: 1, generation: 2 }],
    ]);

    expect(
      preserveInFlightProviderResults(
        {
          claude: { isLoading: true },
          codex: { isLoading: false, detail: makeDetail("codex", "2026-04-15T12:00:00Z") },
        },
        inFlightFetches,
      ),
    ).toEqual({
      claude: { isLoading: true },
    });
  });

  it("accepts only current in-flight provider fetch results", () => {
    const inFlightFetch = { binaryKey: "path\0codexbar", fetchId: 1, generation: 2 };
    const currentProviderIds = new Set(["claude"]);

    expect(
      canApplyProviderFetchResult({
        binaryKey: "path\0codexbar",
        currentBinaryKey: "path\0codexbar",
        currentProviderIds,
        fetchId: 1,
        inFlightFetch,
        providerId: "claude",
      }),
    ).toBe(true);

    expect(
      canApplyProviderFetchResult({
        binaryKey: "path\0codexbar",
        currentBinaryKey: "fallback\0codexbar",
        currentProviderIds,
        fetchId: 1,
        inFlightFetch,
        providerId: "claude",
      }),
    ).toBe(false);

    expect(
      canApplyProviderFetchResult({
        binaryKey: "path\0codexbar",
        currentBinaryKey: "path\0codexbar",
        currentProviderIds: new Set(["codex"]),
        fetchId: 1,
        inFlightFetch,
        providerId: "claude",
      }),
    ).toBe(false);

    expect(
      canApplyProviderFetchResult({
        binaryKey: "path\0codexbar",
        currentBinaryKey: "path\0codexbar",
        currentProviderIds,
        fetchId: 2,
        inFlightFetch,
        providerId: "claude",
      }),
    ).toBe(false);
  });

  it("keeps richer current details over poorer refreshes for any provider", () => {
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

    expect(shouldReplaceProviderDetail(richDetail, poorDetail)).toBe(false);
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

    expect(shouldReplaceProviderDetail(richDetail, newerUsageDetail)).toBe(true);
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

    expect(shouldReplaceProviderDetail(currentDetail, richerDetail)).toBe(true);
  });

  it("does not overwrite richer cached details with poorer background refreshes", () => {
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

    cacheProviderDetail(richDetail);

    expect(cacheProviderDetailIfRicher(poorDetail, now)).toBe(false);
    expect(buildCachedProviderResults(["codex"], now)).toMatchObject({
      codex: {
        detail: {
          sections: [
            { kind: "usage", title: "Primary", resetsIn: "2h" },
            { kind: "supplementalUsage", title: "Codex Spark" },
          ],
        },
      },
    });
  });
});
