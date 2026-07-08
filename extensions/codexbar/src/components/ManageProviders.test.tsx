import { describe, expect, it, vi } from "vitest";

vi.mock("@raycast/api", () => {
  const proxyOfNames = () => new Proxy({}, { get: (_target, prop) => String(prop) });
  return {
    Action: Object.assign(vi.fn(), { Push: vi.fn(), CopyToClipboard: vi.fn(), OpenInBrowser: vi.fn() }),
    ActionPanel: vi.fn(),
    Color: proxyOfNames(),
    Icon: proxyOfNames(),
    List: { Item: vi.fn(), Section: vi.fn(), EmptyView: vi.fn() },
    showToast: vi.fn(),
    Toast: { Style: { Success: "success", Failure: "failure" } },
    environment: { appearance: "light", isDevelopment: false },
  };
});

// Isolate the pure helpers from the data hook (which would pull in @raycast/utils).
vi.mock("../hooks/useAvailableProviders", () => ({ useAvailableProviders: vi.fn() }));

import {
  buildToggleAccessories,
  buildToggleSuccessToast,
  describeManageProvidersError,
  getProviderMoveGating,
} from "./ManageProviders";
import { CodexBarCliError } from "../lib/codexbar";
import type { AvailableProvider } from "../providers/types";

function makeProvider(overrides: Partial<AvailableProvider> & Pick<AvailableProvider, "id">): AvailableProvider {
  return {
    id: overrides.id,
    cliProvider: overrides.cliProvider ?? overrides.id,
    name: overrides.name ?? overrides.id,
    icon: overrides.icon ?? "icon",
    enabled: overrides.enabled ?? true,
    supported: overrides.supported ?? true,
  };
}

describe("getProviderMoveGating", () => {
  it("gates move actions by position within the supported enabled subset", () => {
    const gating = getProviderMoveGating([
      makeProvider({ id: "a" }),
      makeProvider({ id: "b" }),
      makeProvider({ id: "c" }),
    ]);

    expect(gating.get("a")).toEqual({ canMoveUp: false, canMoveDown: true });
    expect(gating.get("b")).toEqual({ canMoveUp: true, canMoveDown: true });
    expect(gating.get("c")).toEqual({ canMoveUp: true, canMoveDown: false });
  });

  it("excludes unsupported providers from reordering and ignores them as neighbors", () => {
    const gating = getProviderMoveGating([
      makeProvider({ id: "known1" }),
      makeProvider({ id: "unknown", supported: false }),
      makeProvider({ id: "known2" }),
    ]);

    expect(gating.has("unknown")).toBe(false);
    // The two supported providers are adjacent to each other, not to `unknown`.
    expect(gating.get("known1")).toEqual({ canMoveUp: false, canMoveDown: true });
    expect(gating.get("known2")).toEqual({ canMoveUp: true, canMoveDown: false });
  });

  it("offers no moves for a single supported provider", () => {
    const gating = getProviderMoveGating([makeProvider({ id: "solo" })]);

    expect(gating.get("solo")).toEqual({ canMoveUp: false, canMoveDown: false });
  });
});

describe("buildToggleAccessories", () => {
  it("shows the pending indicator while updating", () => {
    expect(buildToggleAccessories(makeProvider({ id: "x" }), true)).toEqual([
      { icon: "Hourglass", tooltip: "Updating…" },
    ]);
  });

  it("shows enabled and disabled state for supported providers", () => {
    expect(buildToggleAccessories(makeProvider({ id: "x", enabled: true }), false)).toEqual([
      { icon: { source: "CheckCircle", tintColor: "Green" }, tooltip: "Enabled" },
    ]);
    expect(buildToggleAccessories(makeProvider({ id: "x", enabled: false }), false)).toEqual([
      { icon: "Circle", tooltip: "Disabled" },
    ]);
  });

  it("badges unsupported providers as not shown in the overview", () => {
    const accessories = buildToggleAccessories(makeProvider({ id: "x", supported: false, enabled: true }), false);

    expect(accessories).toHaveLength(2);
    expect(accessories[0]).toEqual({ icon: "Info", tooltip: "Not shown in the Raycast Usage Overview yet" });
  });
});

describe("buildToggleSuccessToast", () => {
  it("titles the toast and hints only when enabling an unsupported provider", () => {
    expect(buildToggleSuccessToast(makeProvider({ id: "x", name: "X" }), true)).toEqual({
      title: "Enabled X",
      message: undefined,
    });
    expect(buildToggleSuccessToast(makeProvider({ id: "x", name: "X" }), false)).toEqual({
      title: "Disabled X",
      message: undefined,
    });
    expect(buildToggleSuccessToast(makeProvider({ id: "x", name: "X", supported: false }), true)).toEqual({
      title: "Enabled X",
      message: "Not shown in the Raycast Usage Overview yet",
    });
  });
});

describe("describeManageProvidersError", () => {
  it("distinguishes roster-load failures by kind", () => {
    expect(describeManageProvidersError(new CodexBarCliError("unavailable", "x")).title).toBe("CodexBar CLI Not Found");
    expect(describeManageProvidersError(new CodexBarCliError("timeout", "x")).title).toBe("CodexBar Timed Out");
    expect(describeManageProvidersError(new CodexBarCliError("execution", "x")).title).toBe(
      "Managing Providers Needs a Newer CodexBar CLI",
    );
    expect(describeManageProvidersError(new Error("plain")).title).toBe("Managing Providers Needs a Newer CodexBar CLI");
  });
});
