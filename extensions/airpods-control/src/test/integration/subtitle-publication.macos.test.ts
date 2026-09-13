import { updateCommandMetadata } from "@raycast/api";
import { expect, vi, test } from "vitest";
import { publishCommandSubtitle, resetCommandSubtitle } from "../../subtitles/coordination";
import { createSupportDirectory } from "../fixtures/support-directory";

const mockUpdateCommandMetadata = vi.mocked(updateCommandMetadata);

// These workflows use macOS lockf and must retain real OS locking.

test.skipIf(process.platform !== "darwin")(
  "publishes a dynamic subtitle and then restores the manifest subtitle",
  async () => {
    // Given
    createSupportDirectory();
    const options = { channel: "listening-mode" as const };
    // When
    await publishCommandSubtitle("◑ Adaptive", options);
    // Then
    expect(mockUpdateCommandMetadata).toHaveBeenLastCalledWith({ subtitle: "◑ Adaptive" });
    // When
    await resetCommandSubtitle(options);
    // Then
    expect(mockUpdateCommandMetadata).toHaveBeenLastCalledWith({ subtitle: null });
  },
);

test.skipIf(process.platform !== "darwin")("restores the manifest subtitle when publication fails", async () => {
  // Given
  createSupportDirectory();
  const options = { channel: "listening-mode" as const };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mockUpdateCommandMetadata.mockRejectedValueOnce(new Error("metadata failed"));
  // When
  await publishCommandSubtitle("◑ Adaptive", options);
  // Then
  expect(mockUpdateCommandMetadata).toHaveBeenNthCalledWith(1, { subtitle: "◑ Adaptive" });
  expect(mockUpdateCommandMetadata).toHaveBeenNthCalledWith(2, { subtitle: null });
});

test.skipIf(process.platform !== "darwin")("does not surface reset failures", async () => {
  // Given
  createSupportDirectory();
  const options = { channel: "listening-mode" as const };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mockUpdateCommandMetadata.mockRejectedValueOnce(new Error("metadata failed"));
  // When
  const result = resetCommandSubtitle(options);
  // Then
  await expect(result).resolves.toBeUndefined();
});
