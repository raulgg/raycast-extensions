/**
 * The menu-bar click, before brew runs. LocalStorage is the in-memory stand-in.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalStorage } from "@raycast/api";
import { forgetUpgraded, readRemoved } from "./outdated-removed";
import { packagesToForget, queueMenuUpgrade } from "./menu-upgrade";
import { queueRun, readUpgradeRun, UPGRADE_RUN_KEY } from "./upgrade-run";

const wget = { name: "wget", isCask: false };
const docker = { name: "docker", isCask: true };

beforeEach(async () => {
  await LocalStorage.clear();
});

describe("queueMenuUpgrade", () => {
  it("does not launch when prepare declines", async () => {
    const launch = vi.fn();

    const skipped = await queueMenuUpgrade(
      {
        live: undefined,
        scope: "one",
        prepare: { status: "skipped" },
        selection: [wget],
        packages: [{ ...wget }],
      },
      launch,
    );
    const aborted = await queueMenuUpgrade(
      {
        live: undefined,
        scope: "one",
        prepare: { status: "aborted" },
        selection: [wget],
        packages: [{ ...wget }],
      },
      launch,
    );

    expect(skipped.launched).toBe(false);
    expect(aborted.launched).toBe(false);
    expect(launch).not.toHaveBeenCalled();
    expect(await readUpgradeRun()).toBeUndefined();
  });

  it("does not write when a run is live", async () => {
    await queueRun({ id: "live", scope: "one", selection: [wget], packages: [wget], now: Date.now() });
    const live = await readUpgradeRun();
    const launch = vi.fn();

    const result = await queueMenuUpgrade(
      {
        live,
        scope: "all",
        selection: [wget, docker],
        packages: [wget, docker],
      },
      launch,
    );

    expect(result).toEqual({ launched: false, refresh: false, hud: "An upgrade is already running" });
    expect(launch).not.toHaveBeenCalled();
    const stored = await readUpgradeRun();
    expect(stored?.id).toBe("live");
    expect(await LocalStorage.getItem(UPGRADE_RUN_KEY)).toContain('"id":"live"');
  });

  it("passes only summary.upgraded to forgetUpgraded", async () => {
    const summary = {
      upgraded: [wget],
      failed: [docker],
      skipped: [{ name: "ripgrep", isCask: false }],
      canceled: false,
    };

    await forgetUpgraded(packagesToForget(summary));

    const removed = await readRemoved();
    expect([...removed.keys()]).toEqual(["formula-wget"]);
    expect(packagesToForget(summary)).toEqual([wget]);
  });
});
