import { execFile, spawn } from "child_process";
import { once } from "events";
import { closeSync, existsSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { environment } from "@raycast/api";
import { expect, test } from "vitest";
import { createSupportDirectory } from "../test/fixtures/support-directory";
import {
  acquireBrewLock,
  brewLockCommand,
  brewLockSupervisorCommand,
  isBrewOperationRunning,
  openBrewLock,
} from "./lock";
import { runProcessWithLifetime } from "./process-lifetime";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Lifetime tests need an immediate observation during the TERM grace period;
// the user-facing status probe deliberately waits out transient contention.
async function isLockHeld(): Promise<boolean> {
  const command = brewLockCommand("/usr/bin/true", []);
  return new Promise((resolve, reject) => {
    execFile(command.file, command.args, (error) => {
      if (!error) resolve(false);
      else if (error.code === 75) resolve(true);
      else reject(error);
    });
  });
}

async function waitForLockState(expected: boolean, timeout = 1500): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await isLockHeld()) === expected) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for lock state ${expected}`);
}

async function waitForFile(path: string, timeout = 2500): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await delay(25);
  }
  throw new Error(`Timed out waiting for file ${path}`);
}

async function runSupervisor(file: string, args: string[], timeout: number) {
  const lockFileDescriptor = openBrewLock();
  try {
    await acquireBrewLock(lockFileDescriptor);
    const command = brewLockSupervisorCommand(file, args);
    return await runProcessWithLifetime(command.file, command.args, { timeout, lockFileDescriptor });
  } finally {
    closeSync(lockFileDescriptor);
  }
}

test.skipIf(process.platform !== "darwin")(
  "reports idle for concurrent status checks when no installation is running",
  async () => {
    // Given
    createSupportDirectory();
    // When
    const results = await Promise.all(Array.from({ length: 12 }, () => isBrewOperationRunning()));
    // Then
    expect(results).toEqual(Array(12).fill(false));
  },
);

test.skipIf(process.platform !== "darwin")("keeps an acquired fd lock until its owner closes the fd", async () => {
  // Given
  createSupportDirectory();
  // When
  const lockFileDescriptor = openBrewLock();
  try {
    await acquireBrewLock(lockFileDescriptor);
    const results = await Promise.all(Array.from({ length: 4 }, () => isBrewOperationRunning()));
    // Then
    expect(results).toEqual(Array(4).fill(true));
  } finally {
    closeSync(lockFileDescriptor);
  }
  const result = await isBrewOperationRunning();
  // Then
  expect(result).toBe(false);
});

test.skipIf(process.platform !== "darwin")(
  "blocks other processes and releases automatically after the owner exits",
  async () => {
    // Given
    createSupportDirectory();
    // When
    const command = brewLockCommand(process.execPath, ["-e", 'process.stdout.write("ready"); process.stdin.resume();']);
    const owner = spawn(command.file, command.args);
    const closed = once(owner, "close");
    try {
      await once(owner.stdout, "data");
      const result = await isBrewOperationRunning();
      // Then
      expect(result).toBe(true);
      // When
      const other = brewLockCommand(process.execPath, ["-e", 'process.stdout.write("started");']);
      const attempt = await new Promise<{ code: string | number | null | undefined; stdout: string }>((resolve) => {
        execFile(other.file, other.args, (error, stdout) => resolve({ code: error?.code, stdout }));
      });
      // Then
      expect(attempt).toEqual({ code: 75, stdout: "" });
    } finally {
      owner.stdin.end();
      await closed;
    }
    const result2 = await isBrewOperationRunning();
    // Then
    expect(result2).toBe(false);
    // When
    const result3 = await isBrewOperationRunning();
    // Then
    expect(result3).toBe(false);
  },
);

test.skipIf(process.platform !== "darwin")(
  "keeps the lock during timeout escalation and kills a TERM-ignoring process group",
  async () => {
    // Given
    createSupportDirectory();
    // When
    const ready = join(environment.supportPath, "timeout-ready");
    const marker = join(environment.supportPath, "timeout-marker");
    rmSync(ready, { force: true });
    rmSync(marker, { force: true });
    const workerScript =
      'trap ":" TERM; /usr/bin/touch "$1"; ( /bin/sleep 5; /usr/bin/touch "$2" ) & while :; do /bin/sleep 1; done';
    const timeout = 3000;
    const startedAt = Date.now();
    let settled = false;
    const operation = runSupervisor("/bin/bash", ["-c", workerScript, "marker-worker", ready, marker], timeout).finally(
      () => {
        settled = true;
      },
    );
    try {
      await waitForFile(ready);
      await delay(Math.max(0, timeout - (Date.now() - startedAt)) + 100);
      // Then
      expect(await isLockHeld()).toBe(true);
      expect(settled).toBe(false);
      const result = await operation;
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);
      // When
      const locked = await isBrewOperationRunning();
      // Then
      expect(locked).toBe(false);
      // When
      await delay(1200);
      const result2 = existsSync(marker);
      // Then
      expect(result2).toBe(false);
    } finally {
      rmSync(ready, { force: true });
      rmSync(marker, { force: true });
    }
  },
  12000,
);

test.skipIf(process.platform !== "darwin")(
  "releases the lock only after an ordinary supervisor completion",
  async () => {
    // Given
    createSupportDirectory();
    // When
    const ready = join(environment.supportPath, "completion-ready");
    const release = join(environment.supportPath, "completion-release");
    const operation = runSupervisor(
      "/bin/bash",
      [
        "-c",
        '/usr/bin/touch "$1"; while [ ! -f "$2" ]; do /bin/sleep .05; done; printf ready',
        "worker",
        ready,
        release,
      ],
      4000,
    );
    try {
      await waitForFile(ready);
      // Then
      expect(await isLockHeld()).toBe(true);
    } finally {
      writeFileSync(release, "");
      await operation;
    }
    const result = await operation;
    // Then
    expect(result).toMatchObject({ exitCode: 0, signal: null, timedOut: false });
    expect(result.stdout).toBe("ready");
    // When
    const locked = await isBrewOperationRunning();
    // Then
    expect(locked).toBe(false);
  },
);

test.skipIf(process.platform !== "darwin")(
  "keeps ownership after the originating process is killed",
  async () => {
    // Given
    createSupportDirectory();
    // When
    const lockPath = join(environment.supportPath, "cli-install.lock");
    const marker = join(environment.supportPath, "parent-death-marker");
    const ready = join(environment.supportPath, "parent-death-ready");
    rmSync(marker, { force: true });
    rmSync(ready, { force: true });
    const command = brewLockSupervisorCommand("/bin/bash", [
      "-c",
      'trap ":" TERM; /usr/bin/touch "$1"; ( /bin/sleep 5; /usr/bin/touch "$2" ) & printf READY; while :; do /bin/sleep 1; done',
      "marker-worker",
      ready,
      marker,
    ]);
    const launcherSource = [
      'const { spawn } = require("child_process");',
      'const { openSync } = require("fs");',
      `const lockFileDescriptor = openSync(${JSON.stringify(lockPath)}, "a+");`,
      `const lock = spawn("/usr/bin/lockf", ["-s", "-t", "0", "3"], { stdio: ["ignore", "ignore", "ignore", lockFileDescriptor] });`,
      `lock.on("close", (code) => { if (code !== 0) process.exit(2); const supervisor = spawn(${JSON.stringify(command.file)}, ${JSON.stringify(command.args)}, { detached: true, stdio: ["pipe", "pipe", "ignore", lockFileDescriptor] }); supervisor.stdout.on("data", (chunk) => { if (chunk.toString().includes("READY")) process.kill(process.pid, "SIGKILL"); }); setTimeout(() => process.kill(process.pid, "SIGKILL"), 3000); });`,
    ].join("\n");
    const launcher = spawn(process.execPath, ["-e", launcherSource], { stdio: "ignore" });
    try {
      const [exitCode, signal] = (await once(launcher, "close")) as [number | null, NodeJS.Signals | null];
      // Then
      expect(exitCode).toBeNull();
      expect(signal).toBe("SIGKILL");
      // When
      await waitForFile(ready);
      await waitForLockState(true);
      await delay(250);
      // Then
      expect(await isLockHeld()).toBe(true);
      // When
      await waitForLockState(false, 4000);
      await delay(1200);
      const result = existsSync(marker);
      // Then
      expect(result).toBe(false);
    } finally {
      rmSync(ready, { force: true });
      rmSync(marker, { force: true });
    }
  },
  12000,
);
