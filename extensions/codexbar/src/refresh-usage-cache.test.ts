import { beforeEach, describe, expect, it, vi } from "vitest";

const { refreshUsageCacheMock } = vi.hoisted(() => ({
  refreshUsageCacheMock: vi.fn(),
}));

vi.mock("./lib/backgroundRefresh", () => ({
  refreshUsageCache: refreshUsageCacheMock,
}));

import Command from "./refresh-usage-cache";

describe("refresh-usage-cache command", () => {
  beforeEach(() => {
    refreshUsageCacheMock.mockReset();
  });

  it("runs a background refresh", async () => {
    refreshUsageCacheMock.mockResolvedValue({
      status: "skipped",
      reason: "codexbar-unavailable",
      errors: [],
    });

    await Command();

    expect(refreshUsageCacheMock).toHaveBeenCalledTimes(1);
  });
});
