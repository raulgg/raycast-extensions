import { Cache, updateCommandMetadata } from "@raycast/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { refreshUsageCacheMock } = vi.hoisted(() => ({
  refreshUsageCacheMock: vi.fn(),
}));

vi.mock("./lib/backgroundRefresh", () => ({
  refreshUsageCache: refreshUsageCacheMock,
}));

import Command from "./refresh-usage-cache";

function armedFlag(): string | undefined {
  return new Cache({ namespace: "refresh-usage-cache" }).get("armed-v1");
}

describe("refresh-usage-cache command", () => {
  beforeEach(() => {
    new Cache({ namespace: "refresh-usage-cache" }).clear();
    refreshUsageCacheMock.mockReset();
    vi.mocked(updateCommandMetadata).mockReset();
    vi.mocked(updateCommandMetadata).mockResolvedValue(undefined);
  });

  it("clears a persisted Root Search subtitle", async () => {
    refreshUsageCacheMock.mockResolvedValue({
      status: "skipped",
      reason: "codexbar-unavailable",
      errors: [],
    });

    await Command();

    expect(updateCommandMetadata).toHaveBeenCalledWith({ subtitle: null });
  });

  it("records a last successful run when the refresh completes", async () => {
    refreshUsageCacheMock.mockResolvedValue({
      status: "completed",
      providerCount: 0,
      refreshedCount: 0,
      unchangedCount: 0,
      errorCount: 0,
      errors: [],
      usedServe: false,
    });

    await Command();

    expect(armedFlag()).toBe("1");
  });

  it("records a last successful run when some providers fail after a completed refresh", async () => {
    refreshUsageCacheMock.mockResolvedValue({
      status: "completed",
      providerCount: 2,
      refreshedCount: 1,
      unchangedCount: 0,
      errorCount: 1,
      errors: [{ providerId: "claude", message: "timed out" }],
      usedServe: true,
    });

    await Command();

    expect(armedFlag()).toBe("1");
  });

  it("does not record a last successful run when the refresh is skipped", async () => {
    refreshUsageCacheMock.mockResolvedValue({
      status: "skipped",
      reason: "codexbar-unavailable",
      errors: [{ message: "CodexBar CLI is unavailable." }],
    });

    await Command();

    expect(armedFlag()).toBeUndefined();
  });
});
