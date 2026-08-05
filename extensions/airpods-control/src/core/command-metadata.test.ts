import { updateCommandMetadata } from "@raycast/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishCommandSubtitle, resetCommandSubtitle } from "./command-metadata";

const mockUpdateCommandMetadata = vi.mocked(updateCommandMetadata);

describe("command metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores the manifest subtitle", async () => {
    await resetCommandSubtitle();

    expect(mockUpdateCommandMetadata).toHaveBeenCalledWith({ subtitle: null });
  });

  it("publishes a dynamic subtitle", async () => {
    await publishCommandSubtitle("◑ Adaptive");

    expect(mockUpdateCommandMetadata).toHaveBeenCalledWith({ subtitle: "◑ Adaptive" });
  });

  it("restores the manifest subtitle when publication fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockUpdateCommandMetadata.mockRejectedValueOnce(new Error("metadata failed"));

    await publishCommandSubtitle("◑ Adaptive");

    expect(mockUpdateCommandMetadata).toHaveBeenNthCalledWith(1, { subtitle: "◑ Adaptive" });
    expect(mockUpdateCommandMetadata).toHaveBeenNthCalledWith(2, { subtitle: null });
  });

  it("does not surface reset failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockUpdateCommandMetadata.mockRejectedValueOnce(new Error("metadata failed"));

    await expect(resetCommandSubtitle()).resolves.toBeUndefined();
  });
});
