import { confirmAlert, launchCommand, showToast } from "@raycast/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cliSetup, installedCli } from "../test/cli-setup-fixture";
import { installCliWithBrew } from "./brew";
import { isCliInstalled } from "./cli";
import { runWithCliGuard } from "./cli-guard";
import { detectCliSetup } from "./cli-setup";

vi.mock("./brew", () => ({ installCliWithBrew: vi.fn() }));
vi.mock("./cli", () => ({ isCliInstalled: vi.fn() }));
vi.mock("./cli-setup", () => ({ detectCliSetup: vi.fn() }));

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
