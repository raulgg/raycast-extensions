import { rmSync } from "fs";
import { environment, updateCommandMetadata } from "@raycast/api";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishCommandSubtitle, resetCommandSubtitle } from "./coordination";

const mockUpdateCommandMetadata = vi.mocked(updateCommandMetadata);

afterAll(() => {
  rmSync(environment.supportPath, { recursive: true, force: true });
});

describe("command metadata", () => {
  const options = { channel: "listening-mode" as const };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores the manifest subtitle", async () => {
    await resetCommandSubtitle(options);

    expect(mockUpdateCommandMetadata).toHaveBeenCalledWith({ subtitle: null });
  });

  it("publishes a dynamic subtitle", async () => {
    await publishCommandSubtitle("◑ Adaptive", options);

    expect(mockUpdateCommandMetadata).toHaveBeenCalledWith({ subtitle: "◑ Adaptive" });
  });

  it("restores the manifest subtitle when publication fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockUpdateCommandMetadata.mockRejectedValueOnce(new Error("metadata failed"));

    await publishCommandSubtitle("◑ Adaptive", options);

    expect(mockUpdateCommandMetadata).toHaveBeenNthCalledWith(1, { subtitle: "◑ Adaptive" });
    expect(mockUpdateCommandMetadata).toHaveBeenNthCalledWith(2, { subtitle: null });
  });

  it("does not surface reset failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockUpdateCommandMetadata.mockRejectedValueOnce(new Error("metadata failed"));

    await expect(resetCommandSubtitle(options)).resolves.toBeUndefined();
  });
});
