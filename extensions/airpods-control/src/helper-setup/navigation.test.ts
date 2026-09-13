import { launchCommand, open, showToast } from "@raycast/api";
import { expect, it, vi } from "vitest";
import { CLI_INSTALL_DOCS_URL } from "./constants";
import { openCliSetup } from "./navigation";

it("offers manual instructions if the setup command is disabled, without retrying the launch", async () => {
  vi.mocked(launchCommand).mockRejectedValueOnce(new Error("command disabled"));
  await openCliSetup();
  expect(launchCommand).toHaveBeenCalledOnce();
  const toast = await vi.mocked(showToast).mock.results[0].value;
  expect(toast.message).toContain("Enable Manage AirPods Control Helper");
  await toast.primaryAction.onAction(toast);
  expect(open).toHaveBeenCalledWith(CLI_INSTALL_DOCS_URL);
});
