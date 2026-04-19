import { describe, expect, it, vi } from "vitest";

const { Action, ActionPanel, List } = vi.hoisted(() => {
  const action = vi.fn();
  Object.assign(action, {
    CopyToClipboard: vi.fn(),
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

import {
  buildProviderListItemAccessories,
  formatProviderDetailErrorTooltip,
  ProviderListItem,
} from "./ProviderListItem";
import type { ProviderDetailData } from "../providers/types";

function makeDetail(remainingPercent: number): ProviderDetailData {
  return {
    id: "codex",
    name: "Codex",
    raw: {},
    fetchedAt: "2026-04-15T12:00:00Z",
    sections: [
      {
        kind: "usage",
        title: "Primary",
        displayTitle: "Session",
        remainingPercent,
      },
    ],
    markdown: "# Codex",
  };
}

describe("ProviderListItem", () => {
  it("adds a copy action for the selected provider fetch command", () => {
    const element = ProviderListItem({
      provider: {
        id: "codex",
        name: "Codex",
        icon: {
          source: "providers/ProviderIcon-codex.svg",
          fallback: "Terminal",
          tintColor: "raycast-primary-text",
        },
      },
      isDetailLoading: false,
      isSelected: true,
      onRefresh: vi.fn(),
    });

    expect(element.props.icon).toEqual({
      source: "providers/ProviderIcon-codex.svg",
      fallback: "Terminal",
      tintColor: "raycast-primary-text",
    });

    const actions = element.props.actions.props.children.flat().filter(Boolean);

    expect(actions).toHaveLength(2);
    expect(actions[1].props.title).toBe("Copy CLI Command");
    expect(actions[1].props.content).toBe("codexbar usage --provider codex");
  });

  it("shows the primary usage remaining percent as a gauge accessory", () => {
    expect(buildProviderListItemAccessories(makeDetail(82), undefined, false)).toEqual([
      {
        icon: "Gauge",
        text: "82%",
        tooltip: "Session remaining: 82%",
      },
    ]);
  });

  it("shows a warning accessory when provider detail failed", () => {
    expect(buildProviderListItemAccessories(undefined, new Error("Timed out while fetching usage"), false)).toEqual([
      {
        icon: "Warning",
        tooltip: "Failed to load usage",
      },
    ]);
  });

  it("keeps the stale primary usage accessory visible while provider detail refreshes", () => {
    expect(buildProviderListItemAccessories(makeDetail(82), undefined, true)).toEqual([
      {
        icon: "Gauge",
        text: "82%",
        tooltip: "Session remaining: 82%",
      },
    ]);
  });

  it("keeps the primary usage accessory visible when stale cached detail also has a refresh error", () => {
    expect(
      buildProviderListItemAccessories(makeDetail(82), new Error("Timed out while fetching usage"), false),
    ).toEqual([
      {
        icon: "Gauge",
        text: "82%",
        tooltip: "Session remaining: 82%",
      },
    ]);
  });

  it("shows a loading accessory while provider detail is loading without cached data", () => {
    expect(buildProviderListItemAccessories(undefined, undefined, true)).toEqual([
      {
        icon: "Hourglass",
        tooltip: "Loading usage",
      },
    ]);
  });

  it("hides accessories when loaded provider detail has no primary usage", () => {
    expect(
      buildProviderListItemAccessories(
        {
          ...makeDetail(82),
          sections: [],
        },
        undefined,
        false,
      ),
    ).toBeUndefined();
  });

  it("uses a generic error tooltip regardless of the underlying detail", () => {
    expect(
      formatProviderDetailErrorTooltip(
        new Error(
          "This provider returned a very long nested CLI error message that includes details users do not need in a compact accessory tooltip",
        ),
      ),
    ).toBe("Failed to load usage");
  });
});
