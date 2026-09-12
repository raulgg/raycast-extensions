import { execFile, spawn } from "child_process";
import { once } from "events";
import { rmSync } from "fs";
import { environment } from "@raycast/api";
import { afterAll, describe, expect, it, vi } from "vitest";
import { brewLockCommand, isBrewOperationRunning } from "./brew-lock";

vi.mock("@raycast/api", async () => {
  const { mkdtempSync } = await import("fs");
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  return { environment: { supportPath: mkdtempSync(join(tmpdir(), "airpods-cli-lock-test-")) } };
});

afterAll(() => rmSync(environment.supportPath, { recursive: true, force: true }));

describe.skipIf(process.platform !== "darwin")("macOS installation lock", () => {
  it("blocks other processes and releases automatically after the owner exits", async () => {
    const command = brewLockCommand(process.execPath, ["-e", 'process.stdout.write("ready"); process.stdin.resume();']);
    const owner = spawn(command.file, command.args);
    const closed = once(owner, "close");
    try {
      await once(owner.stdout, "data");
      expect(await isBrewOperationRunning()).toBe(true);
      const other = brewLockCommand(process.execPath, ["-e", 'process.stdout.write("started");']);
      const attempt = await new Promise<{ code: string | number | null | undefined; stdout: string }>((resolve) => {
        execFile(other.file, other.args, (error, stdout) => resolve({ code: error?.code, stdout }));
      });
      expect(attempt).toEqual({ code: 75, stdout: "" });
    } finally {
      owner.stdin.end();
      await closed;
    }
    // The lock file remains, but it cannot leave setup stuck after process exit.
    expect(await isBrewOperationRunning()).toBe(false);
    expect(await isBrewOperationRunning()).toBe(false);
  });
});
