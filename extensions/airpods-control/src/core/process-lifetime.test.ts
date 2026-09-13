import { describe, expect, it } from "vitest";
import { runProcessWithLifetime } from "./process-lifetime";

describe("process lifetime", () => {
  it("captures output from an ordinary detached supervisor completion", async () => {
    const result = await runProcessWithLifetime("/bin/bash", ["-c", "printf ready; printf warning >&2"], {
      timeout: 1000,
    });

    expect(result).toMatchObject({
      stdout: "ready",
      stderr: "warning",
      exitCode: 0,
      signal: null,
      timedOut: false,
      outputLimitExceeded: false,
    });
  });

  it("closes the lifeline on timeout and reports it after the supervisor exits", async () => {
    const result = await runProcessWithLifetime(
      "/bin/bash",
      ["-c", "while IFS= read -r line; do :; done; printf closed"],
      { timeout: 50 },
    );

    expect(result).toMatchObject({ stdout: "closed", timedOut: true, outputLimitExceeded: false });
  });

  it("closes the lifeline when output exceeds the bounded capture size", async () => {
    const result = await runProcessWithLifetime(
      "/bin/bash",
      ["-c", "for i in 1 2 3 4; do printf 1234567890; done; IFS= read -r line || exit 0"],
      { timeout: 1000, maxBuffer: 32 },
    );

    expect(result.outputLimitExceeded).toBe(true);
    expect(result.timedOut).toBe(false);
  });
});
