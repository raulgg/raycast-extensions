import { describe, expect, it } from "vitest";
import {
  canApplyProviderFetchResult,
  claimProviderOpenRefresh,
  preserveInFlightProviderResults,
  requestForceOnInFlightProviderFetch,
  shouldChainForceProviderFetch,
  type InFlightProviderFetch,
} from "./useProviderDetails";
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

describe("useProviderDetails helpers", () => {
  it("claims one forced refresh per provider source each time the command opens", () => {
    const completedRefreshes = new Set<string>();

    expect(claimProviderOpenRefresh(completedRefreshes, "binary\0claude\0auto")).toBe(true);
    expect(claimProviderOpenRefresh(completedRefreshes, "binary\0claude\0auto")).toBe(false);
    expect(claimProviderOpenRefresh(completedRefreshes, "binary\0claude\0web")).toBe(true);
    expect(claimProviderOpenRefresh(new Set(), "binary\0claude\0auto")).toBe(true);
  });

  it("preserves in-flight provider state across batch resets", () => {
    const inFlightFetches = new Map<string, InFlightProviderFetch>([
      ["claude", { binaryKey: "path\0codexbar", fetchId: 1, generation: 2, mode: "auto", forceRequested: false }],
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
    const inFlightFetch: InFlightProviderFetch = {
      binaryKey: "path\0codexbar",
      fetchId: 1,
      generation: 2,
      mode: "auto",
      forceRequested: false,
    };
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

  it("marks forceRequested when force arrives during an auto in-flight fetch", () => {
    const inFlightFetch: InFlightProviderFetch = {
      binaryKey: "path\0codexbar",
      fetchId: 1,
      generation: 1,
      mode: "auto",
      forceRequested: false,
    };

    requestForceOnInFlightProviderFetch(inFlightFetch, false);
    expect(inFlightFetch.forceRequested).toBe(false);

    requestForceOnInFlightProviderFetch(inFlightFetch, true);
    expect(inFlightFetch.forceRequested).toBe(true);
    expect(shouldChainForceProviderFetch(inFlightFetch, 1)).toBe(true);
  });

  it("does not chain a force fetch when force is already in flight", () => {
    const inFlightFetch: InFlightProviderFetch = {
      binaryKey: "path\0codexbar",
      fetchId: 2,
      generation: 3,
      mode: "force",
      forceRequested: false,
    };

    requestForceOnInFlightProviderFetch(inFlightFetch, true);
    expect(inFlightFetch.forceRequested).toBe(false);
    expect(shouldChainForceProviderFetch(inFlightFetch, 2)).toBe(false);
  });
});
