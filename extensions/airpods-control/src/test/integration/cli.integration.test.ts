import { getPreferenceValues } from "@raycast/api";
import { expect, vi, test } from "vitest";
import { CliError } from "../../cli/errors";
import { runCli } from "../../cli/transport";
import { readInstalledVersion } from "../../cli/version";
import { createFakeCli } from "../fixtures/fake-cli";

const mockGetPreferenceValues = vi.mocked(getPreferenceValues);

async function installFakeCli(body: string) {
  const helper = await createFakeCli(body);
  mockGetPreferenceValues.mockReset().mockReturnValue({ cliPath: helper.path } as never);
  return helper;
}

test("rejects malformed JSON from a real helper process", async () => {
  // Given
  await installFakeCli("printf '%s' 'not json'");
  // When
  const result = runCli(["listening-mode", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({
    name: "CliError",
    code: "invalid-response",
  });
});

test("rejects a successful response missing its command-specific state", async () => {
  // Given
  await installFakeCli('printf \'%s\' \'{"result":"ok","device":"AirPods"}\'');
  // When
  const result = runCli(["listening-mode", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({
    name: "CliError",
    code: "invalid-response",
  });
});

test("passes the command arguments and JSON flag to a real helper process", async () => {
  // Given
  await installFakeCli(
    'test "$1" = listening-mode\ntest "$2" = set\ntest "$3" = adaptive\ntest "$4" = --json\nprintf \'%s\' \'{"device":"AirPods","listeningMode":"adaptive","result":"ok"}\'',
  );
  // When
  const result = runCli(["listening-mode", "set", "adaptive"]);
  // Then
  await expect(result).resolves.toEqual({
    device: "AirPods",
    listeningMode: "adaptive",
    result: "ok",
  });
});

test("keeps stderr diagnostics while preserving a known error", async () => {
  // Given
  await installFakeCli(
    'printf \'%s\' \'{"device":null,"error":"no-device","listeningMode":null,"result":"error"}\'\nprintf \'%s\' \'helper could not find a connected device\' >&2\nexit 1',
  );
  // When
  const result = runCli(["listening-mode", "get"]);
  // Then
  await expect(result).rejects.toMatchObject({
    code: "no-device",
    diagnostics: {
      kind: "process",
      exitCode: 1,
      signal: null,
      stderr: "helper could not find a connected device",
    },
  });
});

test("keeps stderr and exit status for an unknown real-process failure", async () => {
  // Given
  await installFakeCli("printf '%s' 'helper failed unexpectedly' >&2\nexit 70");
  // When
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
  await expect(result).rejects.toThrow("helper failed unexpectedly");
});

test("reports a real process signal separately from the timeout path", async () => {
  // Given
  await installFakeCli("kill -TERM $$");
  // When
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

test("reads the installed helper version from JSON output of a real process", async () => {
  // Given
  const helper = await createFakeCli(
    'test "$1" = --version\ntest "$2" = --json\nprintf \'%s\' \'{"result":"ok","version":"0.4.0"}\'',
  );
  // When
  const version = await readInstalledVersion(helper.path);
  // Then
  expect(version).toBe("0.4.0");
});

test("reads the installed helper version from plain --version output of a real process", async () => {
  // Given
  const helper = await createFakeCli("printf '%s\\n' 'airpods-control 0.3.0'");
  // When
  const version = await readInstalledVersion(helper.path);
  // Then
  expect(version).toBe("0.3.0");
});
