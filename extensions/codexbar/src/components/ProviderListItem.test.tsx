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

import { ProviderListItem } from "./ProviderListItem";

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
});
