import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveCodexBarBinaryMock, smokeTestCodexBarMock } = vi.hoisted(() => ({
  resolveCodexBarBinaryMock: vi.fn(),
  smokeTestCodexBarMock: vi.fn(),
}));

vi.mock("@raycast/api", () => {
  const proxyOfNames = () => new Proxy({}, { get: (_target, prop) => String(prop) });
  return {
    Action: Object.assign(vi.fn(), { CopyToClipboard: vi.fn(), Open: vi.fn(), OpenInBrowser: vi.fn() }),
    ActionPanel: vi.fn(),
    Color: proxyOfNames(),
    confirmAlert: vi.fn(),
    Detail: vi.fn(),
    environment: { appearance: "light", isDevelopment: false },
    Icon: proxyOfNames(),
    showToast: vi.fn(),
    Toast: { Style: { Animated: "animated", Success: "success", Failure: "failure" } },
  };
});

vi.mock("../lib/codexbar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/codexbar")>()),
  resolveCodexBarBinary: resolveCodexBarBinaryMock,
  smokeTestCodexBar: smokeTestCodexBarMock,
}));

import { judgeCliSetup } from "./InstallHelpDetail";
import { CodexBarCliError } from "../lib/codexbar";

const RESOLVED_BINARY = { command: "/usr/local/bin/codexbar", source: "path" as const };

describe("judgeCliSetup", () => {
  beforeEach(() => {
    resolveCodexBarBinaryMock.mockReset();
    smokeTestCodexBarMock.mockReset();
  });

  it("fails with only the status line when the CLI still does not resolve", async () => {
    resolveCodexBarBinaryMock.mockRejectedValue(
      new CodexBarCliError("unavailable", "Unable to find the `codexbar` CLI on this machine."),
    );

    await expect(judgeCliSetup("No writable bin dirs found.")).resolves.toEqual({
      ok: false,
      details: "No writable bin dirs found.",
    });
    expect(smokeTestCodexBarMock).not.toHaveBeenCalled();
  });

  // Regression: a linked helper that resolves (executable bit) but cannot
  // launch — quarantined, wrong architecture, corrupt — must not read as
  // success, and the launch failure must reach the Copy Details payload.
  it("fails with the launch failure appended when the linked CLI resolves but `--version` fails", async () => {
    resolveCodexBarBinaryMock.mockResolvedValue(RESOLVED_BINARY);
    smokeTestCodexBarMock.mockRejectedValue(
      new CodexBarCliError("execution", "CodexBar failed to fetch usage data.", "zsh: killed codexbar --version"),
    );

    await expect(judgeCliSetup("Installed: /usr/local/bin · Installed: /opt/homebrew/bin")).resolves.toEqual({
      ok: false,
      details: [
        "Installed: /usr/local/bin · Installed: /opt/homebrew/bin",
        "Launch failed: CodexBar failed to fetch usage data.",
        "zsh: killed codexbar --version",
      ].join("\n"),
    });
    expect(smokeTestCodexBarMock).toHaveBeenCalledWith(RESOLVED_BINARY);
  });

  it("omits the detail line when the launch failure carries none", async () => {
    resolveCodexBarBinaryMock.mockResolvedValue(RESOLVED_BINARY);
    smokeTestCodexBarMock.mockRejectedValue(
      new CodexBarCliError("timeout", "CodexBar timed out while fetching usage data."),
    );

    await expect(judgeCliSetup("Installed: /usr/local/bin")).resolves.toEqual({
      ok: false,
      details: "Installed: /usr/local/bin\nLaunch failed: CodexBar timed out while fetching usage data.",
    });
  });

  it("succeeds only after both resolution and the smoke test pass", async () => {
    resolveCodexBarBinaryMock.mockResolvedValue(RESOLVED_BINARY);
    smokeTestCodexBarMock.mockResolvedValue(undefined);

    await expect(judgeCliSetup("Installed: /usr/local/bin")).resolves.toEqual({ ok: true });
    expect(smokeTestCodexBarMock).toHaveBeenCalledWith(RESOLVED_BINARY);
  });
});
