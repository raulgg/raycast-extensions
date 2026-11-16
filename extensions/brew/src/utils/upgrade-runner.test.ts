/**
 * The shared outdated-upgrade runner. `brewUpgradeOutdated` is stubbed, so the
 * toast script, the summary, and cancel can be asserted without Homebrew.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { __raycast, environment, LaunchType, type Toast } from "@raycast/api";
import type { UpgradeEvent, UpgradeSummary } from "./brew/upgrade";
import { readRemoved } from "./outdated-removed";

const brewUpgradeOutdated = vi.hoisted(() => vi.fn());

vi.mock("./brew/upgrade", async () => {
  const actual = await vi.importActual<typeof import("./brew/upgrade")>("./brew/upgrade");
  return { ...actual, brewUpgradeOutdated };
});

const { runOutdatedUpgrade } = await import("./upgrade-runner");

const wget = { name: "wget", isCask: false };
const docker = { name: "docker", isCask: true };

function summary(overrides: Partial<UpgradeSummary> = {}): UpgradeSummary {
  return { upgraded: [], failed: [], skipped: [], canceled: false, ...overrides };
}

beforeEach(() => {
  brewUpgradeOutdated.mockReset();
  __raycast.reset();
});

describe("runOutdatedUpgrade", () => {
  it("drives the toast from the event script and returns the summary", async () => {
    brewUpgradeOutdated.mockImplementation(async (options: { onEvent?: (event: UpgradeEvent) => void }) => {
      const onEvent = options.onEvent;
      onEvent?.({ type: "update" });
      onEvent?.({ type: "check" });
      onEvent?.({
        type: "start",
        outdated: { formulae: [], casks: [] },
        packages: [wget, docker],
        skipped: [],
      });
      onEvent?.({ type: "prefetch", progress: { phase: "downloading", message: "Fetching wget", percentage: 10 } });
      onEvent?.({ type: "package", package: wget, status: "upgrading" });
      onEvent?.({
        type: "package",
        package: wget,
        status: "upgrading",
        progress: { phase: "downloading", message: "Downloading wget", percentage: 40 },
      });
      onEvent?.({ type: "package", package: wget, status: "upgraded" });
      onEvent?.({ type: "package", package: docker, status: "upgrading" });
      onEvent?.({ type: "package", package: docker, status: "upgraded" });
      return summary({ upgraded: [wget, docker] });
    });

    const seen: string[] = [];
    const result = await runOutdatedUpgrade({
      selection: [wget, docker],
      onEvent: (event) => {
        if (event.type === "package") seen.push(`${event.package.name}:${event.status}`);
      },
    });

    expect(result).toEqual(summary({ upgraded: [wget, docker] }));
    expect(seen).toEqual(["wget:upgrading", "wget:upgrading", "wget:upgraded", "docker:upgrading", "docker:upgraded"]);
    expect(brewUpgradeOutdated).toHaveBeenCalledWith(
      expect.objectContaining({ greedy: false, selection: [wget, docker] }),
    );

    const toast = __raycast.toasts[0] as Toast & { titles: string[]; messages: string[] };
    expect(toast.titles).toEqual([
      "Upgrading",
      "Upgrading",
      "Downloading 2 packages",
      "Upgrading wget (1/2)",
      "Upgrading docker (2/2)",
      "Upgraded 2 packages",
    ]);
    expect(toast.messages).toEqual([
      "Updating Homebrew…",
      "Updating Homebrew…",
      "Checking for upgrades…",
      "Fetching wget",
      "",
      "Downloading wget",
      "",
    ]);
    const removed = await readRemoved();
    expect(removed.has("formula-wget")).toBe(true);
    expect(removed.has("cask-docker")).toBe(true);
  });

  it("records a removal only for a package the batch actually upgraded", async () => {
    brewUpgradeOutdated.mockImplementation(async (options: { onEvent?: (event: UpgradeEvent) => void }) => {
      options.onEvent?.({ type: "package", package: wget, status: "upgraded" });
      options.onEvent?.({ type: "package", package: docker, status: "failed", message: "declined" });
      options.onEvent?.({ type: "package", package: { name: "ripgrep", isCask: false }, status: "skipped" });
      return summary({ upgraded: [wget], failed: [docker] });
    });

    await runOutdatedUpgrade({});

    const removed = await readRemoved();
    expect([...removed.keys()]).toEqual(["formula-wget"]);
  });

  it("reports a canceled summary", async () => {
    brewUpgradeOutdated.mockResolvedValue(summary({ canceled: true, upgraded: [wget] }));

    const result = await runOutdatedUpgrade({});

    expect(result.canceled).toBe(true);
    const failure = __raycast.toasts.find((toast) => toast.style === "failure");
    expect(failure?.title).toBe("Upgrade Canceled");
    expect(failure?.message).toBe("1 package upgraded");
  });

  it("reports an abort as canceled", async () => {
    brewUpgradeOutdated.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));

    const result = await runOutdatedUpgrade({});

    expect(result).toMatchObject({ canceled: true, upgraded: [] });
    expect(__raycast.toasts.some((toast) => toast.title === "Upgrade Canceled" && toast.style === "failure")).toBe(
      true,
    );
  });

  it("uses a HUD for cancel, partial failure, and abort when the launch is in the background", async () => {
    environment.launchType = LaunchType.Background;

    brewUpgradeOutdated.mockResolvedValueOnce(summary({ canceled: true, upgraded: [wget] }));
    await runOutdatedUpgrade({});

    brewUpgradeOutdated.mockResolvedValueOnce(summary({ failed: [docker], upgraded: [wget] }));
    await runOutdatedUpgrade({});

    brewUpgradeOutdated.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await runOutdatedUpgrade({});

    expect(__raycast.huds).toEqual([
      "Upgrading. Updating Homebrew…",
      "Upgrade Canceled. 1 package upgraded",
      "Upgrading. Updating Homebrew…",
      "Failed to upgrade 1 package. docker",
      "Upgrading. Updating Homebrew…",
      "Upgrade Canceled",
    ]);
    expect(__raycast.toasts).toHaveLength(0);
  });
});
