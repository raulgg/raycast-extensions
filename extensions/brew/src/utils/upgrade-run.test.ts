/**
 * The shared upgrade record. LocalStorage is the in-memory stand-in; nothing
 * here touches brew.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorage } from "@raycast/api";
import {
  LIVE_HEARTBEAT_MS,
  UPGRADE_RUN_KEY,
  claimRun,
  queueRun,
  readLiveRun,
  readUpgradeRun,
  writeUpgradeRun,
  type UpgradeRunRecord,
} from "./upgrade-run";

const NOW = 1_700_000_000_000;

function run(overrides: Partial<UpgradeRunRecord> = {}): UpgradeRunRecord {
  return {
    id: "run-1",
    phase: "queued",
    scope: "one",
    selection: [{ name: "wget", isCask: false }],
    packages: [{ name: "wget", isCask: false, from: "1.24.5", to: "1.25.0" }],
    queuedAt: NOW,
    heartbeatAt: NOW,
    ...overrides,
  };
}

beforeEach(async () => {
  await LocalStorage.clear();
  vi.restoreAllMocks();
});

describe("readLiveRun", () => {
  it("treats a stale queued record as no run", async () => {
    await writeUpgradeRun(run({ phase: "queued", heartbeatAt: NOW - LIVE_HEARTBEAT_MS }));

    expect(await readLiveRun(NOW)).toBeUndefined();
    expect(await readUpgradeRun()).toMatchObject({ id: "run-1", phase: "queued" });
  });

  it("treats a stale running record as no run", async () => {
    await writeUpgradeRun(run({ phase: "running", owner: "worker-a", heartbeatAt: NOW - LIVE_HEARTBEAT_MS - 1 }));

    expect(await readLiveRun(NOW)).toBeUndefined();
  });

  it("keeps a queued or running record whose heartbeat is still fresh", async () => {
    await writeUpgradeRun(run({ phase: "queued", heartbeatAt: NOW - LIVE_HEARTBEAT_MS + 1 }));
    expect(await readLiveRun(NOW)).toMatchObject({ id: "run-1", phase: "queued" });

    await writeUpgradeRun(run({ phase: "running", owner: "worker-a", heartbeatAt: NOW }));
    expect(await readLiveRun(NOW)).toMatchObject({ id: "run-1", phase: "running", owner: "worker-a" });
  });

  it("does not treat a finished phase as live", async () => {
    await writeUpgradeRun(run({ phase: "done", heartbeatAt: NOW }));
    expect(await readLiveRun(NOW)).toBeUndefined();
  });

  it("reads damaged JSON as no run", async () => {
    await LocalStorage.setItem(UPGRADE_RUN_KEY, "{");
    expect(await readUpgradeRun()).toBeUndefined();
    expect(await readLiveRun(NOW)).toBeUndefined();

    await LocalStorage.setItem(UPGRADE_RUN_KEY, JSON.stringify({ phase: "running" }));
    expect(await readUpgradeRun()).toBeUndefined();
    expect(await readLiveRun(NOW)).toBeUndefined();
  });
});

describe("claimRun", () => {
  it("returns nothing when the owner read back is not the one just written", async () => {
    await queueRun({
      id: "run-1",
      scope: "all",
      selection: [{ name: "wget", isCask: false }],
      packages: [{ name: "wget", isCask: false }],
      now: NOW,
    });

    const original = LocalStorage.setItem.bind(LocalStorage);
    vi.spyOn(LocalStorage, "setItem").mockImplementation(async (key, value) => {
      if (key === UPGRADE_RUN_KEY && typeof value === "string") {
        const parsed = JSON.parse(value) as UpgradeRunRecord;
        parsed.owner = "other-worker";
        await original(key, JSON.stringify(parsed));
        return;
      }
      await original(key, value);
    });

    expect(await claimRun("run-1", "worker-a", NOW)).toBeUndefined();
    expect(await readUpgradeRun()).toMatchObject({ owner: "other-worker" });
  });

  it("returns the claimed record when the read-back owner matches", async () => {
    await queueRun({
      id: "run-1",
      scope: "one",
      selection: [{ name: "wget", isCask: false }],
      packages: [{ name: "wget", isCask: false }],
      now: NOW,
    });

    const claimed = await claimRun("run-1", "worker-a", NOW + 10);

    expect(claimed).toMatchObject({ id: "run-1", phase: "running", owner: "worker-a", heartbeatAt: NOW + 10 });
  });
});
