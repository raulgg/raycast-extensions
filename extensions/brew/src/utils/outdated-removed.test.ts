/**
 * Per-package removal keys. LocalStorage is the in-memory stand-in.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { LocalStorage } from "@raycast/api";
import type { Cask, Nameable } from "./types";
import { forgetUpgraded, readRemoved, removalKey, removalStorageKey, subtractRemoved } from "./outdated-removed";

const STARTED_AT = 5_000;

beforeEach(async () => {
  await LocalStorage.clear();
});

describe("removalKey", () => {
  it("keeps formula and cask keys distinct, and matches a tapped formula to its outdated full name", () => {
    expect(removalKey({ name: "wget", isCask: false })).toBe("formula-wget");
    expect(removalKey({ name: "docker", isCask: true })).toBe("cask-docker");

    const installedFormula = { name: "bird", tap: "steipete/tap" } as Nameable;
    expect(removalKey(installedFormula)).toBe("formula-steipete/tap/bird");
    expect(removalKey({ name: "steipete/tap/bird", isCask: false })).toBe(removalKey(installedFormula));

    const installedCask = { token: "foo", tap: "user/repo", name: ["Foo"] } as Cask;
    expect(removalKey(installedCask)).toBe("cask-foo");
    expect(removalKey({ name: "foo", isCask: true })).toBe("cask-foo");

    const qualifiedToken = { token: "user/repo/foo", tap: "user/repo", name: ["Foo"] } as Cask;
    expect(removalKey(qualifiedToken)).toBe("cask-foo");

    expect(removalKey({ name: "docker", isCask: false })).not.toBe(removalKey({ name: "docker", isCask: true }));
  });
});

describe("forgetUpgraded", () => {
  it("keeps both removal writes", async () => {
    await forgetUpgraded([{ name: "wget", isCask: false }], 1_000);
    await forgetUpgraded([{ name: "docker", isCask: true }], 2_000);

    const items = await LocalStorage.allItems();
    expect(items[removalStorageKey("formula-wget")]).toBe("1000");
    expect(items[removalStorageKey("cask-docker")]).toBe("2000");

    const removed = await readRemoved(3_000);
    expect(removed.get("formula-wget")).toBe(1_000);
    expect(removed.get("cask-docker")).toBe(2_000);
  });
});

describe("subtractRemoved", () => {
  const list = {
    formulae: [{ name: "wget" }, { name: "openssl@3" }],
    casks: [{ name: "docker" }, { name: "wget" }],
  };

  it("drops a package only when its removal is newer than the list's fetch start", () => {
    const removed = new Map<string, number>([
      ["formula-wget", STARTED_AT + 1],
      ["cask-docker", STARTED_AT],
      ["formula-openssl@3", STARTED_AT - 1],
    ]);

    expect(subtractRemoved(list, removed, STARTED_AT)).toEqual({
      formulae: [{ name: "openssl@3" }],
      casks: [{ name: "docker" }, { name: "wget" }],
    });
  });

  it("leaves the list unchanged when nothing was removed after the fetch started", () => {
    const removed = new Map<string, number>([["formula-wget", STARTED_AT]]);
    expect(subtractRemoved(list, removed, STARTED_AT)).toEqual(list);
  });
});
