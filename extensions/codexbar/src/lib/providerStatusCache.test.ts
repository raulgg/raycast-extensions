import { Cache } from "@raycast/api";
import { beforeEach, describe, expect, it } from "vitest";
import { cacheProviderStatus, readProviderStatus, readProviderStatuses } from "./providerStatusCache";
import { PROVIDER_STATUS_TTL_MS } from "../providers/status";
import type { ProviderStatus } from "../providers/types";

const status: ProviderStatus = {
  indicator: "minor",
  description: "Partial System Degradation",
  updatedAt: "2026-06-29T07:00:00Z",
  url: "https://status.openai.com/",
};

describe("providerStatusCache", () => {
  beforeEach(() => {
    new Cache({ namespace: "provider-status" }).clear();
  });

  it("round-trips a cached status while fresh", () => {
    const now = Date.parse("2026-07-06T12:00:00Z");
    cacheProviderStatus("codex", status, now);

    expect(readProviderStatus("codex", now)).toEqual(status);
  });

  it("drops a status once past the TTL", () => {
    const writtenAt = Date.parse("2026-07-06T12:00:00Z");
    cacheProviderStatus("codex", status, writtenAt);

    expect(readProviderStatus("codex", writtenAt + PROVIDER_STATUS_TTL_MS + 1000)).toBeUndefined();
  });

  it("returns undefined for providers without cached status", () => {
    expect(readProviderStatus("claude")).toBeUndefined();
  });

  it("reads a map of fresh statuses across providers", () => {
    const now = Date.parse("2026-07-06T12:00:00Z");
    cacheProviderStatus("codex", status, now);
    cacheProviderStatus("claude", { indicator: "maintenance" }, now);

    expect(readProviderStatuses(["codex", "claude", "cursor"], now)).toEqual({
      codex: status,
      claude: { indicator: "maintenance", description: undefined, updatedAt: undefined, url: undefined },
    });
  });
});
