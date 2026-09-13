import { confirmAlert, launchCommand, showToast } from "@raycast/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isCliInstalled } from "../../cli/discovery";
import { detectCliSetup } from "../../helper-setup/detection";
import { runWithCliGuard } from "../../helper-setup/guard";
import { installCliWithBrew } from "../../homebrew/commands";
import { cliSetup, installedCli } from "../cli-setup-fixture";

vi.mock("../../homebrew/commands", () => ({ installCliWithBrew: vi.fn() }));
vi.mock("../../cli/discovery", () => ({ isCliInstalled: vi.fn() }));
vi.mock("../../helper-setup/detection", () => ({ detectCliSetup: vi.fn() }));

describe("command CLI setup trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isCliInstalled).mockReturnValue(false);
    vi.mocked(confirmAlert).mockResolvedValue(true);
    vi.mocked(installCliWithBrew).mockResolvedValue(undefined);
  });

  it("opens the install alert when the CLI is missing and Homebrew is available", async () => {
    vi.mocked(detectCliSetup)
      .mockResolvedValueOnce(cliSetup())
      .mockResolvedValueOnce(cliSetup())
      .mockResolvedValue(installedCli);

    const perform = vi.fn().mockResolvedValue(undefined);
    await runWithCliGuard(perform);

    expect(confirmAlert).toHaveBeenCalledOnce();
    expect(launchCommand).not.toHaveBeenCalled();
    expect(installCliWithBrew).toHaveBeenCalledOnce();
    expect(perform).not.toHaveBeenCalled();
  });

  it("opens the CLI setup view when the CLI and Homebrew are missing", async () => {
    vi.mocked(detectCliSetup).mockResolvedValue(cliSetup({ state: "needs-homebrew", brewPath: null }));

    const perform = vi.fn().mockResolvedValue(undefined);
    await runWithCliGuard(perform);

    expect(launchCommand).toHaveBeenCalledWith({ name: "update-airpods-control-cli", type: "userInitiated" });
    expect(confirmAlert).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(installCliWithBrew).not.toHaveBeenCalled();
    expect(perform).not.toHaveBeenCalled();
  });
});
