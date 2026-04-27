import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderDetailData } from "../providers/types";

const { Detail, appearanceMock, hidePersonalInfoMock } = vi.hoisted(() => {
  return {
    Detail: vi.fn((props: unknown) => ({ props })),
    appearanceMock: { value: "light" as "light" | "dark" },
    hidePersonalInfoMock: { value: false },
  };
});

vi.mock("@raycast/api", () => ({
  environment: {
    get appearance() {
      return appearanceMock.value;
    },
  },
  getPreferenceValues: () => ({
    hidePersonalInfo: hidePersonalInfoMock.value,
  }),
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
    updatedAt: "2026-04-05T17:11:00Z",
    accountEmail: "dev@example.com",
    planText: "Pro",
    markdown: "stale cached markdown",
    sections: [
      {
        kind: "usage",
        title: "Primary",
        displayTitle: "Session",
        remainingPercent: 53,
        resetsIn: "1 hour 30 minutes",
      },
      {
        kind: "info",
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
  const provider = { id: "codex", name: "Codex", icon: "provider-icons/codex.svg" };

  beforeEach(() => {
    hidePersonalInfoMock.value = false;
  });

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
    expect(svg).toContain(">dev@example.com<");
    expect(svg).toContain(">Pro<");
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
    expect(element.props.markdown).toContain("data:image/svg+xml;base64,");
    const svg = decodeFirstSvg(element.props.markdown);
    expect(svg).toContain(">Codex<");
    expect(svg).toContain(">Updating...<");
    expect(svg).not.toContain(">Session<");
    expect(element.props.metadata).toBeUndefined();
  });

  it("keeps cached detail visible while loading and swaps subtitle to updating", () => {
    appearanceMock.value = "light";
    const detail = makeDetail();

    const element = ProviderDetail({
      provider,
      detail,
      isLoading: true,
    });

    expect(element.props.isLoading).toBe(true);
    const svg = decodeFirstSvg(element.props.markdown);
    expect(svg).toContain(">Codex<");
    expect(svg).toContain(">Updating...<");
    expect(svg).toContain(">dev@example.com<");
    expect(svg).toContain(">Pro<");
    expect(svg).not.toContain(">Updated ");
    expect(svg).toContain(">Session<");
  });

  it("shows stale warning copy while refreshing stale cached detail", () => {
    appearanceMock.value = "light";
    const detail = makeDetail();

    const element = ProviderDetail({
      provider,
      detail,
      isLoading: true,
      cacheStatus: "stale",
      relativeTimeNow: Date.parse("2026-04-05T17:40:00Z"),
    });

    const svg = decodeFirstSvg(element.props.markdown);
    expect(svg).toContain(">Updating... | ⚠︎ Stale data<");
    expect(svg).toContain(">Session<");
  });

  it("keeps stale cached detail visible after refresh errors", () => {
    appearanceMock.value = "light";
    const detail = makeDetail();

    const element = ProviderDetail({
      provider,
      detail,
      error: new Error("Timed out"),
      isLoading: false,
      cacheStatus: "stale",
      relativeTimeNow: Date.parse("2026-04-05T17:40:00Z"),
    });

    const svg = decodeFirstSvg(element.props.markdown);
    expect(svg).toContain(">Updated 29m ago | ⚠︎ Stale data<");
    expect(svg).toContain(">Session<");
    expect(svg).not.toContain(">Timed out<");
  });

  it("hides account email when personal info preference is enabled", () => {
    appearanceMock.value = "light";
    hidePersonalInfoMock.value = true;
    const detail = makeDetail();

    const element = ProviderDetail({
      provider,
      detail,
      isLoading: false,
    });

    const svg = decodeFirstSvg(element.props.markdown);
    expect(svg).toContain(">Codex<");
    expect(svg).not.toContain(">dev@example.com<");
    expect(svg).not.toContain(">Hidden<");
    expect(svg).toContain(">Pro<");
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
