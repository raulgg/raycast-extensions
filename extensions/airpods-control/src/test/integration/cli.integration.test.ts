import { getPreferenceValues } from "@raycast/api";
import { expect, vi, test } from "vitest";
import { CliError } from "../../cli/errors";
import { runCli } from "../../cli/transport";
import { createFakeCli } from "../fixtures/fake-cli";

const mockGetPreferenceValues = vi.mocked(getPreferenceValues);

async function installFakeCli(body: string) {
  const helper = await createFakeCli(body);
  mockGetPreferenceValues.mockReset().mockReturnValue({ cliPath: helper.path } as never);
  return helper;
}

test("rejects malformed JSON from a real helper process", async () => {
  // Given the input supplied by this case
  // When
  await installFakeCli("printf '%s' 'not json'");
  const result = runCli(["listening-mode", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({
    name: "CliError",
    code: "invalid-response",
  });
});

test("rejects a successful response missing its command-specific state", async () => {
  // Given the input supplied by this case
  // When
  await installFakeCli('printf \'%s\' \'{"result":"ok","device":"AirPods"}\'');
  const result = runCli(["listening-mode", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({
    name: "CliError",
    code: "invalid-response",
  });
});

test("passes the command arguments and JSON flag to a real helper process", async () => {
  // Given the input supplied by this case
  // When
  await installFakeCli(
    'test "$1" = listening-mode\ntest "$2" = set\ntest "$3" = adaptive\ntest "$4" = --json\nprintf \'%s\' \'{"device":"AirPods","listeningMode":"adaptive","result":"ok"}\'',
  );
  const result = runCli(["listening-mode", "set", "adaptive"]);
  // Then
  await expect(result).resolves.toEqual({
    device: "AirPods",
    listeningMode: "adaptive",
    result: "ok",
  });
});

test("keeps a bounded stderr diagnostic while preserving a known error", async () => {
  // Given the input supplied by this case
  // When
  await installFakeCli(
    'printf \'%s\' \'{"device":null,"error":"no-device","listeningMode":null,"result":"error"}\'\nprintf \'%s\' \'helper could not find a connected device\' >&2\nexit 1',
  );
  const result = runCli(["listening-mode", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({
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

test("keeps stderr and exit status for an unknown real-process failure", async () => {
  // Given the input supplied by this case
  // When
  await installFakeCli("printf '%s' 'helper failed unexpectedly' >&2\nexit 70");
  const result = runCli(["listening-mode", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({
    code: "unknown",
    diagnostics: {
      kind: "process",
      exitCode: 70,
      signal: null,
      stderr: "helper failed unexpectedly",
    },
  });
  // When
  const result2 = runCli(["listening-mode", "get"]);
  // Then
  await expect(result2).rejects.toThrow("helper failed unexpectedly");
});

test("reports a real process signal separately from the timeout path", async () => {
  // Given the input supplied by this case
  // When
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
