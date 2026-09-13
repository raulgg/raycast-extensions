import { launchCommand, open, showToast } from "@raycast/api";
import { expect, vi, test } from "vitest";
import { CLI_INSTALL_DOCS_URL } from "./constants";
import { openCliSetup } from "./navigation";

test("offers manual instructions if the setup command is disabled, without retrying the launch", async () => {
  // Given
  vi.mocked(launchCommand).mockRejectedValueOnce(new Error("command disabled"));
  // When
  await openCliSetup();
  // Then
  expect(launchCommand).toHaveBeenCalledOnce();
  const toast = await vi.mocked(showToast).mock.results[0].value;
  expect(toast.message).toContain("Enable Manage AirPods Control Helper");
  // When
  await toast.primaryAction.onAction(toast);
  // Then
  expect(open).toHaveBeenCalledWith(CLI_INSTALL_DOCS_URL);
});
