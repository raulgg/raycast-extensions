/**
 * Menu-bar upgrade count: the title, and the `brew outdated` call behind it.
 * `execBrew` is stubbed. Nothing here runs Homebrew.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, LocalStorage } from "@raycast/api";
import { BrewLockError } from "./errors";
import { forgetUpgraded } from "./outdated-removed";
import { MENU_BAR_UPGRADES_CACHE_KEY, MENU_BAR_UPGRADES_CACHE_NAMESPACE } from "./menu-bar-upgrades";

const execBrew = vi.hoisted(() => vi.fn());
vi.mock("./brew/commands", () => ({ execBrew }));

const pinnedOnDisk = vi.hoisted(() => vi.fn());
vi.mock("./brew/helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./brew/helpers")>()),
  brewPinnedIdentifiersSync: pinnedOnDisk,
}));

function pinOnDisk(formulae: string[], casks: string[] = []) {
  pinnedOnDisk.mockReturnValue({ formulae: new Set(formulae), casks: new Set(casks) });
}

const {
  loadMenuBarUpgrades,
  menuBarPinnedCount,
  menuBarPinnedTitle,
  peekMenuBarUpgrades,
  menuBarTitle,
  menuBarTooltip,
  menuBarUpgradeCount,
  menuBarServicesSectionTitle,
  menuBarUpgradesSectionTitle,
  invalidateMenuBarUpgrades,
  pendingMenuBarUpgrades,
} = await import("./menu-bar-upgrades");

function upgradeNames(results: { formulae: { name: string }[]; casks: { name: string }[] }): string[] {
  return [...results.formulae.map((formula) => formula.name), ...results.casks.map((cask) => cask.name)];
}

const ONE_HOUR_MS = 1 * 60 * 60 * 1000;
const NO_UPDATE = { env: { HOMEBREW_NO_AUTO_UPDATE: "1" } };

const OUTDATED_STDOUT = JSON.stringify({
  formulae: [
    { name: "wget", pinned: true, current_version: "1.25.0", installed_versions: ["1.24.5"] },
    { name: "openssl@3", pinned: false, current_version: "3.6.0", installed_versions: ["3.4.0"] },
  ],
  casks: [
    {
      name: "visual-studio-code",
      pinned: false,
      current_version: "1.96.0",
      installed_versions: ["1.95.0"],
    },
  ],
});

function outdatedResult() {
  return { stdout: OUTDATED_STDOUT, stderr: "" };
}

function emptyResult() {
  return { stdout: JSON.stringify({ formulae: [], casks: [] }), stderr: "" };
}

function clearUpgradeCache() {
  new Cache({ namespace: MENU_BAR_UPGRADES_CACHE_NAMESPACE }).clear();
}

describe("menu bar title", () => {
  it("keeps a plain service count when nothing is outdated", () => {
    expect(menuBarTitle(2, 0)).toBe("2");
    expect(menuBarTitle(2, undefined)).toBe("2");
    expect(menuBarTitle(0, 0)).toBeUndefined();
    expect(menuBarTooltip(2, 0)).toBe("Homebrew Services");
    expect(menuBarTooltip(0, undefined)).toBe("Homebrew Services");
  });

  it("appends the upgrade count with an arrow", () => {
    expect(menuBarTitle(2, 3)).toBe("2 \u21913");
    expect(menuBarTitle(0, 3)).toBe("0 \u21913");
    expect(menuBarTooltip(2, 3)).toBe("2 services running \u00b7 3 upgrades");
    expect(menuBarTooltip(1, 1)).toBe("1 service running \u00b7 1 upgrade");
    expect(menuBarTooltip(0, 3)).toBe("0 services running \u00b7 3 upgrades");
  });

  it("puts the upgrade count on the section title and leaves it plain at zero", () => {
    expect(menuBarUpgradesSectionTitle(0)).toBe("Upgrades");
    expect(menuBarUpgradesSectionTitle(1)).toBe("Upgrades \u00b7 1 outdated");
    expect(menuBarUpgradesSectionTitle(3)).toBe("Upgrades \u00b7 3 outdated");
  });

  it("puts running and error counts on the services section title", () => {
    expect(menuBarServicesSectionTitle(0, 0)).toBe("Services");
    expect(menuBarServicesSectionTitle(1, 0)).toBe("1 running");
    expect(menuBarServicesSectionTitle(2, 0)).toBe("2 running");
    expect(menuBarServicesSectionTitle(0, 1)).toBe("1 error");
    expect(menuBarServicesSectionTitle(0, 2)).toBe("2 errors");
    expect(menuBarServicesSectionTitle(1, 2)).toBe("1 running \u00b7 2 errors");
  });
});

describe("menu bar upgrade fetch", () => {
  beforeEach(async () => {
    clearUpgradeCache();
    execBrew.mockReset();
    pinnedOnDisk.mockReset();
    pinOnDisk(["wget"]);
    await LocalStorage.clear();
  });

  it("runs brew outdated and never brew update", async () => {
    execBrew.mockResolvedValue(outdatedResult());

    const outcome = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });

    expect(outcome.status).toBe("fetched");
    expect(execBrew.mock.calls.map((call) => call[0])).toEqual(["outdated --json=v2"]);
    expect(execBrew).toHaveBeenCalledWith("outdated --json=v2", NO_UPDATE);
    if (outcome.status === "fetched") {
      // Pinned wget stays on the list but is not pending.
      expect(menuBarUpgradeCount(outcome.results)).toBe(2);
      expect(menuBarPinnedCount(outcome.results)).toBe(1);
      expect(upgradeNames(outcome.results)).toEqual(["wget", "openssl@3", "visual-studio-code"]);
    }
  });

  it("passes --greedy only when Greedy Upgrades is on", async () => {
    execBrew.mockResolvedValue(emptyResult());

    await loadMenuBarUpgrades({ enabled: true, greedy: true, now: 1_000 });

    expect(execBrew).toHaveBeenCalledTimes(1);
    expect(execBrew).toHaveBeenCalledWith("outdated --json=v2 --greedy", NO_UPDATE);
  });

  it("does not run brew outdated when the upgrade count is turned off", async () => {
    execBrew.mockResolvedValue(outdatedResult());

    const outcome = await loadMenuBarUpgrades({ enabled: false, greedy: true, force: true, now: 1_000 });

    expect(outcome).toEqual({ status: "disabled" });
    expect(execBrew).not.toHaveBeenCalled();
  });

  it("reuses a list that is less than 1 hour old", async () => {
    execBrew.mockResolvedValue(outdatedResult());
    await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    execBrew.mockClear();

    const reused = await loadMenuBarUpgrades({
      enabled: true,
      greedy: false,
      now: 1_000 + ONE_HOUR_MS - 1,
    });

    expect(reused.status).toBe("cached");
    expect(execBrew).not.toHaveBeenCalled();
    if (reused.status === "cached") {
      expect(upgradeNames(reused.results)).toEqual(["wget", "openssl@3", "visual-studio-code"]);
    }
  });

  it("fetches again once the list is 1 hour old", async () => {
    execBrew.mockResolvedValue(outdatedResult());
    await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    execBrew.mockClear();

    const again = await loadMenuBarUpgrades({
      enabled: true,
      greedy: false,
      now: 1_000 + ONE_HOUR_MS,
    });

    expect(again.status).toBe("fetched");
    expect(execBrew).toHaveBeenCalledTimes(1);
    expect(execBrew).toHaveBeenCalledWith("outdated --json=v2", NO_UPDATE);
  });

  it("replaces a fresh empty list when Refresh asks and brew now reports a package", async () => {
    pinOnDisk([]);
    execBrew.mockResolvedValue(emptyResult());
    await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    execBrew.mockClear();
    execBrew.mockResolvedValue({
      stdout: JSON.stringify({
        formulae: [{ name: "wget", pinned: false, current_version: "1.25.0", installed_versions: ["1.24.5"] }],
        casks: [],
      }),
      stderr: "",
    });

    const refreshed = await loadMenuBarUpgrades({ enabled: true, greedy: false, force: true, now: 2_000 });
    execBrew.mockClear();
    const shown = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 3_000 });

    expect(refreshed.status).toBe("fetched");
    expect(shown.status).toBe("cached");
    if (shown.status === "cached") {
      expect(upgradeNames(shown.results)).toEqual(["wget"]);
      expect(menuBarTitle(2, menuBarUpgradeCount(shown.results))).toBe("2 \u21911");
    }
    expect(execBrew).not.toHaveBeenCalled();
  });

  it("fetches immediately when Refresh upgrades asks, even if the list is fresh", async () => {
    execBrew.mockResolvedValue(outdatedResult());
    await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    execBrew.mockClear();
    execBrew.mockResolvedValue(emptyResult());

    const refreshed = await loadMenuBarUpgrades({ enabled: true, greedy: false, force: true, now: 2_000 });

    expect(refreshed.status).toBe("fetched");
    expect(execBrew).toHaveBeenCalledTimes(1);
    if (refreshed.status === "fetched") {
      expect(menuBarUpgradeCount(refreshed.results)).toBe(0);
      expect(menuBarUpgradesSectionTitle(menuBarUpgradeCount(refreshed.results))).toBe("Upgrades");
    }
  });

  it("refetches when Greedy Upgrades no longer matches the cached list", async () => {
    execBrew.mockResolvedValue(outdatedResult());
    await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    execBrew.mockClear();

    const flipped = await loadMenuBarUpgrades({ enabled: true, greedy: true, now: 2_000 });

    expect(flipped.status).toBe("fetched");
    expect(execBrew).toHaveBeenCalledWith("outdated --json=v2 --greedy", NO_UPDATE);
  });

  it("keeps the last list when a later fetch fails, without calling that up to date", async () => {
    execBrew.mockResolvedValueOnce(outdatedResult());
    await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    execBrew.mockRejectedValueOnce(new Error("brew: lock"));

    const failedAt = 1_000 + ONE_HOUR_MS;
    const failed = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: failedAt });

    expect(failed.status).toBe("failed");
    if (failed.status === "failed") {
      expect(upgradeNames(failed.results ?? { formulae: [], casks: [] })).toEqual([
        "wget",
        "openssl@3",
        "visual-studio-code",
      ]);
      expect(menuBarUpgradesSectionTitle(menuBarUpgradeCount(failed.results ?? { formulae: [], casks: [] }))).toBe(
        "Upgrades \u00b7 2 outdated",
      );
    }
    execBrew.mockClear();

    // The failure is remembered, so the next minute does not run brew again,
    // and the packages from the last success stay on the menu.
    const minuteLater = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: failedAt + 60_000 });
    expect(minuteLater.status).toBe("failed");
    if (minuteLater.status === "failed") {
      expect(upgradeNames(minuteLater.results ?? { formulae: [], casks: [] })).toEqual([
        "wget",
        "openssl@3",
        "visual-studio-code",
      ]);
    }
    expect(execBrew).not.toHaveBeenCalled();
  });

  it("does not run brew outdated on the next minute after a failure, and does not invent an empty list", async () => {
    execBrew.mockRejectedValue(new Error("brew: command not found"));

    const first = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    const minuteLater = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 + 60_000 });

    expect(first.status).toBe("failed");
    expect(minuteLater.status).toBe("failed");
    if (first.status === "failed" && minuteLater.status === "failed") {
      expect(first.results).toBeUndefined();
      expect(minuteLater.results).toBeUndefined();
    }
    expect(execBrew).toHaveBeenCalledTimes(1);

    const forced = await loadMenuBarUpgrades({ enabled: true, greedy: false, force: true, now: 1_000 + 120_000 });
    expect(forced.status).toBe("failed");
    expect(execBrew).toHaveBeenCalledTimes(2);

    const oneHourAfterForce = await loadMenuBarUpgrades({
      enabled: true,
      greedy: false,
      now: 1_000 + 120_000 + ONE_HOUR_MS,
    });
    expect(oneHourAfterForce.status).toBe("failed");
    expect(execBrew).toHaveBeenCalledTimes(3);
    expect(execBrew.mock.calls.map((call) => call[0])).toEqual([
      "outdated --json=v2",
      "outdated --json=v2",
      "outdated --json=v2",
    ]);
  });

  it("remembers a brew lock so a later launch can still say brew is busy", async () => {
    execBrew.mockRejectedValueOnce(new BrewLockError("Another brew process is already running"));
    await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    execBrew.mockClear();

    const again = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 2_000 });

    expect(again.status).toBe("failed");
    if (again.status === "failed") {
      expect(again.error).toBeInstanceOf(BrewLockError);
    }
    expect(execBrew).not.toHaveBeenCalled();
  });

  it("fetches when the cached snapshot is unreadable", async () => {
    new Cache({ namespace: MENU_BAR_UPGRADES_CACHE_NAMESPACE }).set(MENU_BAR_UPGRADES_CACHE_KEY, "{");
    execBrew.mockResolvedValue(emptyResult());

    const outcome = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });

    expect(outcome.status).toBe("fetched");
    expect(execBrew).toHaveBeenCalledTimes(1);
  });

  it("returns the in-flight check and does not start brew outdated", async () => {
    expect(pendingMenuBarUpgrades(false)).toBeUndefined();

    let resolveBrew: (value: { stdout: string; stderr: string }) => void = () => {};
    execBrew.mockReturnValue(
      new Promise((resolve) => {
        resolveBrew = resolve;
      }),
    );

    const running = loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    expect(pendingMenuBarUpgrades(false)).toBe(running);
    expect(pendingMenuBarUpgrades(true)).toBeUndefined();
    expect(execBrew).toHaveBeenCalledTimes(1);

    resolveBrew(emptyResult());
    await running;

    expect(pendingMenuBarUpgrades(false)).toBeUndefined();
    expect(execBrew).toHaveBeenCalledTimes(1);
  });

  it("shares one brew outdated between callers that arrive together", async () => {
    let resolveBrew: (value: { stdout: string; stderr: string }) => void = () => {};
    execBrew.mockReturnValue(
      new Promise((resolve) => {
        resolveBrew = resolve;
      }),
    );

    const first = loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    const second = loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    resolveBrew(emptyResult());
    const [a, b] = await Promise.all([first, second]);

    expect(execBrew).toHaveBeenCalledTimes(1);
    expect(a.status).toBe("fetched");
    expect(b.status).toBe("fetched");
  });

  it("joins Refresh onto the upgrade check already running for that setting", async () => {
    let resolveBrew: (value: { stdout: string; stderr: string }) => void = () => {};
    execBrew.mockReturnValue(
      new Promise((resolve) => {
        resolveBrew = resolve;
      }),
    );

    const automatic = loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    const forced = loadMenuBarUpgrades({ enabled: true, greedy: false, force: true, now: 1_000 });
    resolveBrew(emptyResult());
    const [a, b] = await Promise.all([automatic, forced]);

    expect(execBrew).toHaveBeenCalledTimes(1);
    expect(a.status).toBe("fetched");
    expect(b.status).toBe("fetched");
  });

  it("drops a removed package from a fresh snapshot without calling brew", async () => {
    const start = Date.now();
    execBrew.mockResolvedValue(outdatedResult());
    await loadMenuBarUpgrades({ enabled: true, greedy: false, now: start });
    await forgetUpgraded([{ name: "openssl@3", isCask: false }], start + 1_500);
    execBrew.mockClear();

    const reused = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: start + 2_000 });

    expect(execBrew).not.toHaveBeenCalled();
    expect(reused.status).toBe("cached");
    if (reused.status === "cached") {
      expect(upgradeNames(reused.results)).toEqual(["wget", "visual-studio-code"]);
      expect(menuBarUpgradeCount(reused.results)).toBe(1);
    }
  });

  it("shows a package a forced refresh still lists", async () => {
    const start = Date.now();
    execBrew.mockResolvedValue(outdatedResult());
    await loadMenuBarUpgrades({ enabled: true, greedy: false, now: start });
    await forgetUpgraded([{ name: "openssl@3", isCask: false }], start + 1_500);
    execBrew.mockClear();

    const forced = await loadMenuBarUpgrades({ enabled: true, greedy: false, force: true, now: start + 3_000 });

    expect(execBrew).toHaveBeenCalledTimes(1);
    expect(forced.status).toBe("fetched");
    if (forced.status === "fetched") {
      expect(upgradeNames(forced.results)).toEqual(["wget", "openssl@3", "visual-studio-code"]);
    }
  });

  it("keeps the previous fetch start when a later check fails", async () => {
    const start = Date.now();
    execBrew.mockResolvedValueOnce(outdatedResult());
    await loadMenuBarUpgrades({ enabled: true, greedy: false, now: start });
    await forgetUpgraded([{ name: "openssl@3", isCask: false }], start + 1_500);

    execBrew.mockRejectedValueOnce(new Error("brew: command not found"));
    const failed = await loadMenuBarUpgrades({ enabled: true, greedy: false, force: true, now: start + 4_000 });

    expect(failed.status).toBe("failed");
    if (failed.status === "failed") {
      expect(upgradeNames(failed.results ?? { formulae: [], casks: [] })).toEqual(["wget", "visual-studio-code"]);
    }
  });

  it("fetches again after a preview upgrade drops the cached list", async () => {
    execBrew.mockResolvedValue(outdatedResult());
    await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    invalidateMenuBarUpgrades();
    execBrew.mockClear();

    const again = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 2_000 });

    expect(again.status).toBe("fetched");
    expect(execBrew).toHaveBeenCalledTimes(1);
  });

  it("caches an empty outdated list so an up-to-date Mac is not checked every minute", async () => {
    execBrew.mockResolvedValue(emptyResult());
    const fetched = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    execBrew.mockClear();

    const reused = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 2_000 });

    expect(fetched.status).toBe("fetched");
    expect(reused.status).toBe("cached");
    if (reused.status === "cached") {
      expect(menuBarUpgradeCount(reused.results)).toBe(0);
      expect(upgradeNames(reused.results)).toEqual([]);
    }
    expect(execBrew).not.toHaveBeenCalled();
  });
});

describe("services menu bar manifest", () => {
  it("keeps the services-menu command and shows the upgrade count by default", () => {
    const root = process.env.RAYCAST_EXTENSION_ROOT;
    if (!root) {
      throw new Error("RAYCAST_EXTENSION_ROOT is not set");
    }
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      commands: {
        name: string;
        title: string;
        mode: string;
        interval?: string;
        keywords?: string[];
        preferences?: { name: string; type: string; default?: boolean }[];
      }[];
    };
    const command = manifest.commands.find((entry) => entry.name === "services-menu");

    expect(command).toMatchObject({
      name: "services-menu",
      title: "Brew Menu Bar",
      mode: "menu-bar",
      interval: "1m",
      keywords: ["services", "upgrades", "homebrew"],
    });
    expect(command?.preferences).toContainEqual(
      expect.objectContaining({ name: "showUpgradeCount", type: "checkbox", default: true }),
    );
  });

  it("keeps Run Queued Upgrade launchable, with no interval", () => {
    const root = process.env.RAYCAST_EXTENSION_ROOT;
    if (!root) throw new Error("RAYCAST_EXTENSION_ROOT is not set");
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      commands: { name: string; title: string; mode: string; interval?: string; disabledByDefault?: boolean }[];
    };
    const command = manifest.commands.find((entry) => entry.name === "run-upgrade");

    expect(command).toMatchObject({ name: "run-upgrade", title: "Run Queued Upgrade", mode: "no-view" });
    expect(command?.interval).toBeUndefined();
    expect(command?.disabledByDefault).toBeUndefined();
  });
});

describe("menu bar pins", () => {
  beforeEach(async () => {
    clearUpgradeCache();
    execBrew.mockReset();
    pinnedOnDisk.mockReset();
    await LocalStorage.clear();
  });

  it("marks a package pinned after the snapshot without calling brew", async () => {
    pinOnDisk([]);
    execBrew.mockResolvedValue(outdatedResult());
    await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    execBrew.mockClear();
    pinOnDisk(["wget", "openssl@3"]);

    const reused = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 2_000 });

    expect(execBrew).not.toHaveBeenCalled();
    expect(reused.status).toBe("cached");
    if (reused.status === "cached") {
      expect(upgradeNames(reused.results)).toEqual(["wget", "openssl@3", "visual-studio-code"]);
      expect(menuBarUpgradeCount(reused.results)).toBe(1);
      expect(menuBarPinnedCount(reused.results)).toBe(2);
      expect(menuBarTitle(2, menuBarUpgradeCount(reused.results))).toBe("2 \u21911");
    }
  });

  it("counts a package again once it is unpinned", async () => {
    pinOnDisk(["wget"]);
    execBrew.mockResolvedValue(outdatedResult());
    await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    pinOnDisk([]);

    const reused = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 2_000 });

    if (reused.status !== "cached") throw new Error(`expected cached, got ${reused.status}`);
    expect(menuBarUpgradeCount(reused.results)).toBe(3);
    expect(menuBarPinnedCount(reused.results)).toBe(0);
  });

  it("applies pins to the list painted before the async read", async () => {
    pinOnDisk([]);
    execBrew.mockResolvedValue(outdatedResult());
    await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });
    pinOnDisk(["openssl@3"]);

    const peeked = peekMenuBarUpgrades(false, 2_000);

    expect(peeked.results && menuBarUpgradeCount(peeked.results)).toBe(2);
    expect(peeked.results && menuBarPinnedCount(peeked.results)).toBe(1);
  });

  it("keeps formula and cask pins apart", async () => {
    pinOnDisk(["visual-studio-code"]);
    execBrew.mockResolvedValue(outdatedResult());
    const formulaPin = await loadMenuBarUpgrades({ enabled: true, greedy: false, force: true, now: 1_000 });
    pinOnDisk([], ["visual-studio-code"]);
    const caskPin = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 2_000 });

    if (formulaPin.status !== "fetched" || caskPin.status !== "cached") throw new Error("unexpected status");
    expect(formulaPin.results.casks[0].pinned).toBe(false);
    expect(caskPin.results.casks[0].pinned).toBe(true);
    expect(menuBarUpgradeCount(caskPin.results)).toBe(2);
  });

  it("matches a tapped formula by its short pin name", async () => {
    pinOnDisk(["birdclaw"]);
    execBrew.mockResolvedValue({
      stdout: JSON.stringify({
        formulae: [
          { name: "steipete/tap/birdclaw", pinned: false, current_version: "2.0", installed_versions: ["1.0"] },
        ],
        casks: [],
      }),
      stderr: "",
    });

    const outcome = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });

    if (outcome.status !== "fetched") throw new Error(`expected fetched, got ${outcome.status}`);
    expect(menuBarUpgradeCount(outcome.results)).toBe(0);
    expect(menuBarTitle(1, menuBarUpgradeCount(outcome.results))).toBe("1");
  });

  it("keeps brew's own flags when the pin directories cannot be read", async () => {
    pinnedOnDisk.mockImplementation(() => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    });
    execBrew.mockResolvedValue(outdatedResult());

    const outcome = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: 1_000 });

    if (outcome.status !== "fetched") throw new Error(`expected fetched, got ${outcome.status}`);
    expect(menuBarUpgradeCount(outcome.results)).toBe(2);
    expect(menuBarPinnedCount(outcome.results)).toBe(1);
  });

  it("hides a removed package whether or not it is pinned", async () => {
    const start = Date.now();
    pinOnDisk(["wget"]);
    execBrew.mockResolvedValue(outdatedResult());
    await loadMenuBarUpgrades({ enabled: true, greedy: false, now: start });
    await forgetUpgraded([{ name: "wget", isCask: false }], start + 1_500);

    const reused = await loadMenuBarUpgrades({ enabled: true, greedy: false, now: start + 2_000 });

    if (reused.status !== "cached") throw new Error(`expected cached, got ${reused.status}`);
    expect(upgradeNames(reused.results)).toEqual(["openssl@3", "visual-studio-code"]);
    expect(menuBarPinnedCount(reused.results)).toBe(0);
  });

  it("titles the pinned submenu with its count", () => {
    expect(menuBarPinnedTitle(4)).toBe("Pinned \u00b7 4");
  });
});
