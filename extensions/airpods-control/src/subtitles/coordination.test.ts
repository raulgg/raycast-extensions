import { updateCommandMetadata } from "@raycast/api";
import { expect, vi, test } from "vitest";
import { createSupportDirectory } from "../test/fixtures/support-directory";
import { publishCommandSubtitle, resetCommandSubtitle } from "./coordination";

const mockUpdateCommandMetadata = vi.mocked(updateCommandMetadata);

test("publishes a dynamic subtitle and then restores the manifest subtitle", async () => {
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
});

test("restores the manifest subtitle when publication fails", async () => {
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

test("does not surface reset failures", async () => {
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
