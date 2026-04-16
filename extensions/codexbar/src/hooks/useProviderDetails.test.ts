import { describe, expect, it } from "vitest";
import {
  buildFreshCachedProviderResults,
  cacheProviderDetail,
  runProviderDetailFetches,
  shouldRefreshSelectedProvider,
} from "./useProviderDetails";
import type { ProviderDetailData } from "../providers/types";

function makeDetail(providerId: string, fetchedAt: string): ProviderDetailData {
  return {
    id: providerId,
    name: providerId,
    raw: {},
    fetchedAt,
    sections: [
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

    expect(buildFreshCachedProviderResults(["codex"], now)).toMatchObject({
      codex: {
        detail: { id: "codex", sections: [{ kind: "usage", remainingPercent: 82 }] },
        isLoading: false,
      },
    });
  });

  it("ignores cached provider details older than five minutes", () => {
    const now = Date.parse("2026-04-15T12:05:01Z");
    cacheProviderDetail(makeDetail("claude", "2026-04-15T12:00:00Z"));

    expect(buildFreshCachedProviderResults(["claude"], now)).toEqual({});
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
});
