/**
 * The batch skips untrusted third-party packages instead of naming them.
 * `brew trust` is stubbed. Nothing here runs Homebrew.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const brewPackageTrust = vi.hoisted(() => vi.fn());

vi.mock("./taps", () => ({ brewPackageTrust }));

const { untrustedBatchSkip } = await import("./upgrade");

beforeEach(() => {
  brewPackageTrust.mockReset();
});

describe("untrustedBatchSkip", () => {
  it("skips an untrusted third-party package and leaves core, cask, trusted, and pre-trust Homebrew alone", async () => {
    brewPackageTrust.mockResolvedValue("untrusted");
    expect(await untrustedBatchSkip({ name: "user/repo/foo", isCask: false })).toBe("Untrusted");

    expect(await untrustedBatchSkip({ name: "wget", isCask: false })).toBeUndefined();
    expect(await untrustedBatchSkip({ name: "docker", isCask: true })).toBeUndefined();
    expect(brewPackageTrust).toHaveBeenCalledTimes(1);

    brewPackageTrust.mockResolvedValue("trusted");
    expect(await untrustedBatchSkip({ name: "user/repo/foo", isCask: false })).toBeUndefined();

    brewPackageTrust.mockResolvedValue("unsupported");
    expect(await untrustedBatchSkip({ name: "user/repo/foo", isCask: false })).toBeUndefined();
  });

  it("skips when the trust check itself fails", async () => {
    brewPackageTrust.mockRejectedValue(new Error("Another brew process is already running"));
    expect(await untrustedBatchSkip({ name: "user/repo/foo", isCask: false })).toBe("Could not check trust");
  });
});
