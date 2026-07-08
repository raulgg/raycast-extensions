import { describe, expect, it, vi } from "vitest";
const { Action, ActionPanel, List } = vi.hoisted(() => {
  const action = vi.fn();
  Object.assign(action, {
    CopyToClipboard: vi.fn(),
    OpenInBrowser: vi.fn(),
  });

  return {
    Action: action,
    ActionPanel: vi.fn(),
    List: {
      Item: vi.fn(),
    },
  };
});

vi.mock("@raycast/api", () => ({
  Action,
  ActionPanel,
  Color: {
    PrimaryText: "raycast-primary-text",
    SecondaryText: "raycast-secondary-text",
    Yellow: "raycast-yellow",
    Red: "raycast-red",
  },
  Icon: new Proxy(
    {},
    {
      get: (_target, prop) => String(prop),
    },
  ),
  List,
}));

vi.mock("./ProviderDetail", () => ({
  ProviderDetail: vi.fn(() => null),
}));

vi.mock("./ManageProvidersAction", () => ({
  ManageProvidersAction: vi.fn(() => null),
}));

import {
  buildProviderListItemAccessories,
  formatProviderDetailErrorTooltip,
  formatProviderDetailStaleTooltip,
  ProviderListItem,
} from "./ProviderListItem";
import { getProviderProgressPalette } from "../providers/registry";
import type { ProviderDetailData } from "../providers/types";

function makeDetail(remainingPercent: number, secondaryRemainingPercent?: number): ProviderDetailData {
  return {
    id: "codex",
    name: "Codex",
    fetchedAt: "2026-04-15T12:00:00Z",
    sections: [
      {
        kind: "usage",
        title: "Primary",
        displayTitle: "Session",
        remainingPercent,
      },
      ...(secondaryRemainingPercent === undefined
        ? []
        : [
            {
              kind: "usage" as const,
              title: "Secondary" as const,
              displayTitle: "Weekly",
              remainingPercent: secondaryRemainingPercent,
            },
          ]),
    ],
  };
}

describe("ProviderListItem", () => {
  it("adds a copy action for the selected provider fetch command", () => {
    const element = ProviderListItem({
      provider: {
        id: "codex",
        name: "Codex",
        icon: {
          source: "provider-icons/codex.svg",
          fallback: "Terminal",
          tintColor: "raycast-primary-text",
        },
      },
      isDetailLoading: false,
      isSelected: true,
      onRefresh: vi.fn(),
    });

    expect(element.props.icon).toEqual({
      source: "provider-icons/codex.svg",
      fallback: "Terminal",
      tintColor: "raycast-primary-text",
    });

    const actions = element.props.actions.props.children.flat().filter(Boolean);

    expect(actions).toHaveLength(5);
    expect(actions[1].props.title).toBe("Open Usage Dashboard");
    expect(actions[1].props.url).toBe("https://chatgpt.com/codex/settings/usage");
    expect(actions[1].props.shortcut).toEqual({ modifiers: ["cmd"], key: "o" });
    expect(actions[2].props.title).toBe("Open Status Page");
    expect(actions[2].props.url).toBe("https://status.openai.com/");
    expect(actions[2].props.shortcut).toEqual({ modifiers: ["cmd", "shift"], key: "o" });
    // actions[3] is the Manage Providers action (mocked to render null in this test).
    expect(actions[4].props.title).toBe("Copy CLI Command");
    expect(actions[4].props.content).toBe("codexbar usage --provider codex");
    expect(actions[4].props.shortcut).toEqual({ modifiers: ["cmd", "shift"], key: "c" });
  });

  it("opens the Claude subscription dashboard when the loaded plan is a subscription", () => {
    const element = ProviderListItem({
      provider: { id: "claude", name: "Claude", icon: { source: "provider-icons/claude.svg" } },
      detail: {
        id: "claude",
        name: "Claude",
        fetchedAt: "2026-04-15T12:00:00Z",
        planText: "Claude Max",
        sections: [],
      },
      isDetailLoading: false,
      isSelected: true,
      onRefresh: vi.fn(),
    });

    const actions = element.props.actions.props.children.flat().filter(Boolean);
    const dashboardAction = actions.find(
      (action: { props: { title?: string } }) => action.props.title === "Open Usage Dashboard",
    );

    expect(dashboardAction?.props.url).toBe("https://claude.ai/settings/usage");
  });

  it("opens the plain Claude console dashboard when detail (and plan) has not loaded", () => {
    const element = ProviderListItem({
      provider: { id: "claude", name: "Claude", icon: { source: "provider-icons/claude.svg" } },
      isDetailLoading: false,
      isSelected: true,
      onRefresh: vi.fn(),
    });

    const actions = element.props.actions.props.children.flat().filter(Boolean);
    const dashboardAction = actions.find(
      (action: { props: { title?: string } }) => action.props.title === "Open Usage Dashboard",
    );

    expect(dashboardAction?.props.url).toBe("https://console.anthropic.com/settings/billing");
  });

  it("adds move actions with keyboard shortcuts when reordering is available", () => {
    const element = ProviderListItem({
      provider: {
        id: "codex",
        name: "Codex",
        icon: {
          source: "provider-icons/codex.svg",
          fallback: "Terminal",
          tintColor: "raycast-primary-text",
        },
      },
      isDetailLoading: false,
      isSelected: true,
      onRefresh: vi.fn(),
      onMoveUp: vi.fn(),
      onMoveDown: vi.fn(),
    });

    const actions = element.props.actions.props.children.flat().filter(Boolean);

    expect(actions).toHaveLength(7);
    expect(actions[1].props.title).toBe("Open Usage Dashboard");
    expect(actions[2].props.title).toBe("Open Status Page");
    expect(actions[3].props.title).toBe("Move Up");
    expect(actions[3].props.shortcut).toEqual({ modifiers: ["cmd", "opt"], key: "arrowUp" });
    expect(actions[4].props.title).toBe("Move Down");
    expect(actions[4].props.shortcut).toEqual({ modifiers: ["cmd", "opt"], key: "arrowDown" });
    // actions[5] is the Manage Providers action (mocked to render null in this test).
    expect(actions[6].props.title).toBe("Copy CLI Command");
    expect(actions[6].props.shortcut).toEqual({ modifiers: ["cmd", "shift"], key: "c" });
  });

  it("shows both primary and secondary usage in text, tooltip, and icon", () => {
    const accessories = buildProviderListItemAccessories("codex", makeDetail(82, 41), undefined, false);

    expectProgressAccessories(accessories, "codex", {
      primary: 82,
      secondary: 41,
      text: "82% • 41%",
      tooltip: "Session: 82% remaining • Weekly: 41% remaining",
    });
  });

  it("keeps fresh cached usage visible while provider detail refreshes", () => {
    const accessories = buildProviderListItemAccessories("codex", makeDetail(82, 41), undefined, true, "fresh");

    expectProgressAccessories(accessories, "codex", {
      primary: 82,
      secondary: 41,
      text: "82% • 41%",
      tooltip: "Session: 82% remaining • Weekly: 41% remaining",
    });
  });

  it("shows a warning accessory when provider detail failed", () => {
    expect(
      buildProviderListItemAccessories("codex", undefined, new Error("Timed out while fetching usage"), false),
    ).toEqual([
      {
        icon: "Warning",
        tooltip: "Failed to load usage",
      },
    ]);
  });

  it("shows a loading accessory while stale provider detail refreshes", () => {
    expect(buildProviderListItemAccessories("codex", makeDetail(82, 41), undefined, true, "stale")).toEqual([
      {
        icon: "Hourglass",
        tooltip: "Loading usage",
      },
    ]);
  });

  it("shows a warning accessory when stale provider detail finished loading without an error", () => {
    expect(buildProviderListItemAccessories("codex", makeDetail(82, 41), undefined, false, "stale")).toEqual([
      {
        icon: "Warning",
        tooltip: "Stale usage data",
      },
    ]);
  });

  it("shows a warning accessory when stale cached detail also has a refresh error", () => {
    expect(
      buildProviderListItemAccessories(
        "codex",
        makeDetail(82, 41),
        new Error("Timed out while fetching usage"),
        false,
        "stale",
      ),
    ).toEqual([
      {
        icon: "Warning",
        tooltip: "Stale usage data",
      },
    ]);
  });

  it("shows a loading accessory while provider detail is loading without cached data", () => {
    expect(buildProviderListItemAccessories("codex", undefined, undefined, true)).toEqual([
      {
        icon: "Hourglass",
        tooltip: "Loading usage",
      },
    ]);
  });

  it("hides accessories when loaded provider detail has no primary usage", () => {
    expect(
      buildProviderListItemAccessories(
        "codex",
        {
          ...makeDetail(82),
          sections: [],
        },
        undefined,
        false,
      ),
    ).toBeUndefined();
  });

  it("shows only primary text and tooltip while keeping an empty lower track when secondary is missing", () => {
    const accessories = buildProviderListItemAccessories("codex", makeDetail(82), undefined, false);

    expectProgressAccessories(accessories, "codex", {
      primary: 82,
      text: "82%",
      tooltip: "Session: 82% remaining",
      secondaryMissing: true,
    });
  });

  it("shows an empty lower track when secondary exists at zero", () => {
    const accessories = buildProviderListItemAccessories("codex", makeDetail(82, 0), undefined, false);

    expectProgressAccessories(accessories, "codex", {
      primary: 82,
      secondary: 0,
      text: "82% • 0%",
      tooltip: "Session: 82% remaining • Weekly: 0% remaining",
    });
  });

  it("keeps accessories usage-only during an incident", () => {
    const accessories = buildProviderListItemAccessories("codex", makeDetail(82, 41), undefined, false);

    expect(accessories).toHaveLength(2);
    expectProgressAccessories(accessories, "codex", {
      primary: 82,
      secondary: 41,
      text: "82% • 41%",
      tooltip: "Session: 82% remaining • Weekly: 41% remaining",
    });
  });

  it("adds an Open Status Page action when a renderable status carries a url", () => {
    const element = ProviderListItem({
      provider: { id: "codex", name: "Codex", icon: { source: "provider-icons/codex.svg" } },
      isDetailLoading: false,
      isSelected: true,
      status: { indicator: "minor", url: "https://status.openai.com/" },
      onRefresh: vi.fn(),
    });

    const actions = element.props.actions.props.children.flat().filter(Boolean);
    const statusAction = actions.find(
      (action: { props: { title?: string } }) => action.props.title === "Open Status Page",
    );

    expect(statusAction?.props.url).toBe("https://status.openai.com/");
    expect(statusAction?.props.shortcut).toEqual({ modifiers: ["cmd", "shift"], key: "o" });
  });

  it("keeps the Open Status Page action for a provider with a registry status page even without an incident", () => {
    const element = ProviderListItem({
      provider: { id: "codex", name: "Codex", icon: { source: "provider-icons/codex.svg" } },
      isDetailLoading: false,
      isSelected: true,
      status: { indicator: "none", url: "https://status.openai.com/" },
      onRefresh: vi.fn(),
    });

    const actions = element.props.actions.props.children.flat().filter(Boolean);
    const statusAction = actions.find(
      (action: { props: { title?: string } }) => action.props.title === "Open Status Page",
    );

    expect(statusAction?.props.url).toBe("https://status.openai.com/");
  });

  it("keeps the Open Status Page action when the status cache is cold, using the registry url", () => {
    const element = ProviderListItem({
      provider: { id: "codex", name: "Codex", icon: { source: "provider-icons/codex.svg" } },
      isDetailLoading: false,
      isSelected: true,
      onRefresh: vi.fn(),
    });

    const actions = element.props.actions.props.children.flat().filter(Boolean);
    const statusAction = actions.find(
      (action: { props: { title?: string } }) => action.props.title === "Open Status Page",
    );

    expect(statusAction?.props.url).toBe("https://status.openai.com/");
  });

  it("falls back to the cached status url for a provider without a registry status page", () => {
    const element = ProviderListItem({
      provider: { id: "synthetic", name: "Synthetic", icon: { source: "provider-icons/synthetic.svg" } },
      isDetailLoading: false,
      isSelected: true,
      status: { indicator: "none", url: "https://status.example.com/" },
      onRefresh: vi.fn(),
    });

    const actions = element.props.actions.props.children.flat().filter(Boolean);
    const statusAction = actions.find(
      (action: { props: { title?: string } }) => action.props.title === "Open Status Page",
    );

    expect(statusAction?.props.url).toBe("https://status.example.com/");
  });

  it("omits the Open Status Page action when there is no registry url and no cached status", () => {
    const element = ProviderListItem({
      provider: { id: "synthetic", name: "Synthetic", icon: { source: "provider-icons/synthetic.svg" } },
      isDetailLoading: false,
      isSelected: true,
      onRefresh: vi.fn(),
    });

    const actions = element.props.actions.props.children.flat().filter(Boolean);

    expect(actions.some((action: { props: { title?: string } }) => action.props.title === "Open Status Page")).toBe(
      false,
    );
  });

  it("uses a generic error tooltip regardless of the underlying detail", () => {
    expect(formatProviderDetailErrorTooltip()).toBe("Failed to load usage");
  });

  it("uses a generic stale tooltip regardless of the underlying detail", () => {
    expect(formatProviderDetailStaleTooltip()).toBe("Stale usage data");
  });
});

function expectProgressAccessories(
  accessories: { icon?: unknown; text?: string; tooltip?: string }[] | undefined,
  providerId: string,
  expected: {
    primary: number;
    secondary?: number;
    secondaryMissing?: boolean;
    text: string;
    tooltip: string;
  },
): void {
  expect(accessories).toHaveLength(2);

  const [textAccessory, iconAccessory] = accessories ?? [];
  expect(textAccessory).toEqual({
    text: expected.text,
    tooltip: expected.tooltip,
  });
  expect(iconAccessory?.text).toBeUndefined();
  expect(iconAccessory?.tooltip).toBe(expected.tooltip);

  const icon = iconAccessory?.icon as { source?: { light?: string; dark?: string } } | undefined;
  expect(icon?.source?.light).toContain("data:image/svg+xml;base64,");
  expect(icon?.source?.dark).toContain("data:image/svg+xml;base64,");

  const lightSvg = decodeSvgDataUri(icon?.source?.light);
  const darkSvg = decodeSvgDataUri(icon?.source?.dark);
  const palette = getProviderProgressPalette(providerId);

  expect(lightSvg).toContain('viewBox="0 0 36 36"');
  expect(lightSvg).toContain(`fill="${palette.lightFill}"`);
  expect(darkSvg).toContain(`fill="${palette.darkFill}"`);
  expect(lightSvg).toContain('x="3" y="6" width="30" height="12"');
  expect(lightSvg).toContain('x="3" y="24" width="30" height="8"');
  expect(lightSvg).toContain('stroke="#000000"');
  expect(darkSvg).toContain('stroke="#FFFFFF"');
  expect(lightSvg).toContain(
    `x="3" y="6" width="${Math.round((30 * expected.primary) / 100)}" height="12" rx="6" fill="${palette.lightFill}"`,
  );

  if (expected.secondaryMissing || expected.secondary === 0) {
    expect(lightSvg).not.toContain(`height="8" rx="4" fill="${palette.lightFill}"`);
  } else {
    expect(lightSvg).toContain(
      `x="3" y="24" width="${Math.round((30 * (expected.secondary ?? 0)) / 100)}" height="8" rx="4" fill="${palette.lightFill}"`,
    );
  }
}

function decodeSvgDataUri(source: string | undefined): string {
  const prefix = "data:image/svg+xml;base64,";
  expect(source).toContain(prefix);

  return Buffer.from(source?.slice(prefix.length) ?? "", "base64").toString("utf8");
}
