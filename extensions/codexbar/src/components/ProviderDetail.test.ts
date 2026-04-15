import { describe, expect, it, vi } from "vitest";
import type { ProviderDetailData } from "../providers/types";

const { Detail, appearanceMock } = vi.hoisted(() => {
  return {
    Detail: vi.fn((props: unknown) => ({ props })),
    appearanceMock: { value: "light" as "light" | "dark" },
  };
});

vi.mock("@raycast/api", () => ({
  environment: {
    get appearance() {
      return appearanceMock.value;
    },
  },
  Color: {
    PrimaryText: "raycast-primary-text",
  },
  Icon: {
    Terminal: "Terminal",
    Bubble: "Bubble",
    ArrowRightCircle: "ArrowRightCircle",
    Code: "Code",
    Circle: "Circle",
    Bolt: "Bolt",
    Person: "Person",
    Globe: "Globe",
    BarChart: "BarChart",
    AppWindow: "AppWindow",
    Box: "Box",
    TwoPeople: "TwoPeople",
  },
  List: {
    Item: {
      Detail,
    },
  },
}));

import { ProviderDetail } from "./ProviderDetail";

function makeDetail(): ProviderDetailData {
  return {
    id: "codex",
    name: "Codex",
    raw: {},
    fetchedAt: "2026-04-05T17:11:00Z",
    markdown: "stale cached markdown",
    sections: [
      {
        title: "Primary",
        progressPercent: 53,
        items: [
          { label: "Remaining", value: "53%" },
          { label: "Resets In", value: "1 hour 30 minutes" },
        ],
      },
      {
        title: "General",
        items: [{ label: "Last Updated", value: "Apr 5, 2026, 5:11 PM" }],
      },
    ],
  };
}

function decodeFirstSvg(markdown: string): string {
  const match = markdown.match(/data:image\/svg\+xml;base64,([^?]+)\?/);
  expect(match).not.toBeNull();
  return Buffer.from(match?.[1] ?? "", "base64").toString("utf8");
}

describe("ProviderDetail", () => {
  const provider = { id: "codex", name: "Codex", icon: "providers/ProviderIcon-codex.svg" };

  it("renders themed markdown from the current appearance", () => {
    appearanceMock.value = "light";
    const detail = makeDetail();

    const element = ProviderDetail({
      provider,
      detail,
      isLoading: false,
    });

    expect(element.props.markdown).not.toContain(detail.markdown);
    expect(element.props.markdown).toContain("data:image/svg+xml;base64,");
    const svg = decodeFirstSvg(element.props.markdown);
    expect(svg).toContain('fill="#111827"');
    expect(svg).toContain('fill="#49A3B0"');
    expect(svg).toContain(">Session<");
    expect(element.props.metadata).toBeUndefined();
  });

  it("switches svg colors with the dark appearance", () => {
    appearanceMock.value = "dark";
    const detail = makeDetail();

    const element = ProviderDetail({
      provider,
      detail,
      isLoading: false,
    });

    const svg = decodeFirstSvg(element.props.markdown);
    expect(svg).toContain('fill="#F3F4F6"');
    expect(svg).toContain('fill="#6DB5C0"');
    expect(svg).toContain(">Session<");
  });

  it("renders a loading markdown state when no cached detail exists", () => {
    const element = ProviderDetail({
      provider,
      isLoading: true,
    });

    expect(element.props.isLoading).toBe(true);
    expect(element.props.markdown).toContain("Loading");
    expect(element.props.metadata).toBeUndefined();
  });

  it("renders a no-data markdown state when no detail is available", () => {
    const element = ProviderDetail({
      provider,
      isLoading: false,
    });

    expect(element.props.markdown).toContain("No data available");
    expect(element.props.metadata).toBeUndefined();
  });

  it("renders only error markdown when detail is unavailable", () => {
    appearanceMock.value = "light";
    const element = ProviderDetail({
      provider,
      error: new Error("Timed out"),
      isLoading: false,
    });

    expect(element.props.markdown).toContain("data:image/svg+xml;base64,");
    const svg = decodeFirstSvg(element.props.markdown);
    expect(svg).toContain(">Codex<");
    expect(svg).toContain(">Timed out<");
    expect(svg).toContain('fill="#111827"');
    expect(svg).toContain('stroke="#E5E7EB"');
    expect(svg).toContain('fill="#FF6B6B"');
    expect(element.props.metadata).toBeUndefined();
  });

  it("renders themed error markdown in dark appearance", () => {
    appearanceMock.value = "dark";
    const element = ProviderDetail({
      provider,
      error: new Error("Timed out"),
      isLoading: false,
    });

    const svg = decodeFirstSvg(element.props.markdown);
    expect(svg).toContain('fill="#F3F4F6"');
    expect(svg).toContain('stroke="#374151"');
    expect(svg).toContain('fill="#FF6B6B"');
  });
});
