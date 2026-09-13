import { expect, test } from "vitest";
import { runProcessWithLifetime } from "./process-lifetime";

test("captures output from an ordinary detached supervisor completion", async () => {
  // Given the input supplied by this case
  // When
  const result = await runProcessWithLifetime("/bin/bash", ["-c", "printf ready; printf warning >&2"], {
    timeout: 1000,
  });
  // Then
  expect(result).toMatchObject({
    stdout: "ready",
    stderr: "warning",
    exitCode: 0,
    signal: null,
    timedOut: false,
    outputLimitExceeded: false,
  });
});

test("closes the lifeline on timeout and reports it after the supervisor exits", async () => {
  // Given the input supplied by this case
  // When
  const result = await runProcessWithLifetime(
    "/bin/bash",
    ["-c", "while IFS= read -r line; do :; done; printf closed"],
    { timeout: 50 },
  );
  // Then
  expect(result).toMatchObject({ stdout: "closed", timedOut: true, outputLimitExceeded: false });
});

test("closes the lifeline when output exceeds the bounded capture size", async () => {
  // Given the input supplied by this case
  // When
  const result = await runProcessWithLifetime(
    "/bin/bash",
    ["-c", "for i in 1 2 3 4; do printf 1234567890; done; IFS= read -r line || exit 0"],
    { timeout: 1000, maxBuffer: 32 },
  );
  // Then
  expect(result.outputLimitExceeded).toBe(true);
  expect(result.timedOut).toBe(false);
});
