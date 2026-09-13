import { chmod, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getPreferenceValues } from "@raycast/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliError } from "../../cli/errors";
import { runCli } from "../../cli/transport";

const mockGetPreferenceValues = vi.mocked(getPreferenceValues);
let tempDirectory: string;
let fakeCliPath: string;

async function installFakeCli(body: string): Promise<void> {
  tempDirectory = await mkdtemp(join(tmpdir(), "airpods-control-cli-test-"));
  fakeCliPath = join(tempDirectory, "airpods-control");
  await writeFile(fakeCliPath, `#!/bin/sh\nset -eu\n${body}\n`, "utf8");
  await chmod(fakeCliPath, 0o755);
  mockGetPreferenceValues.mockReturnValue({ cliPath: fakeCliPath } as never);
}

describe("CLI transport integration", () => {
  beforeEach(() => {
    tempDirectory = "";
    fakeCliPath = "";
    mockGetPreferenceValues.mockReset();
  });

  afterEach(async () => {
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("rejects malformed JSON from a real helper process", async () => {
    await installFakeCli("printf '%s' 'not json'");

    await expect(runCli(["listening-mode", "get"])).rejects.toMatchObject({
      name: "CliError",
      code: "invalid-response",
    });
  });

  it("rejects a successful response missing its command-specific state", async () => {
    await installFakeCli('printf \'%s\' \'{"result":"ok","device":"AirPods"}\'');

    await expect(runCli(["listening-mode", "get"])).rejects.toMatchObject({
      name: "CliError",
      code: "invalid-response",
    });
  });

  it("passes the command arguments and JSON flag to a real helper process", async () => {
    await installFakeCli(
      'test "$1" = listening-mode\ntest "$2" = set\ntest "$3" = adaptive\ntest "$4" = --json\nprintf \'%s\' \'{"device":"AirPods","listeningMode":"adaptive","result":"ok"}\'',
    );

    await expect(runCli(["listening-mode", "set", "adaptive"])).resolves.toEqual({
      device: "AirPods",
      listeningMode: "adaptive",
      result: "ok",
    });
  });

  it("keeps a bounded stderr diagnostic while preserving a known error", async () => {
    await installFakeCli(
      'printf \'%s\' \'{"device":null,"error":"no-device","listeningMode":null,"result":"error"}\'\nprintf \'%s\' \'helper could not find a connected device\' >&2\nexit 1',
    );

    await expect(runCli(["listening-mode", "get"])).rejects.toMatchObject({
      code: "no-device",
      message: "Connect your AirPods to your Mac and try again.",
      diagnostics: {
        kind: "process",
        exitCode: 1,
        signal: null,
        stderr: "helper could not find a connected device",
      },
    });
  });

  it("keeps stderr and exit status for an unknown real-process failure", async () => {
    await installFakeCli("printf '%s' 'helper failed unexpectedly' >&2\nexit 70");

    await expect(runCli(["listening-mode", "get"])).rejects.toMatchObject({
      code: "unknown",
      diagnostics: {
        kind: "process",
        exitCode: 70,
        signal: null,
        stderr: "helper failed unexpectedly",
      },
    });
    await expect(runCli(["listening-mode", "get"])).rejects.toThrow("helper failed unexpectedly");
  });

  it("reports a real process signal separately from the timeout path", async () => {
    await installFakeCli("kill -TERM $$");

    try {
      await runCli(["conversation-awareness", "get"]);
      expect.unreachable("runCli should reject a signalled helper");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect(error).toMatchObject({
        code: "unknown",
        diagnostics: { kind: "killed", signal: "SIGTERM" },
      });
      expect((error as CliError).message).toContain("terminated by SIGTERM");
    }
  });
});
