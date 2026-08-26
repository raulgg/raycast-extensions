import { describe, expect, it } from "vitest";
import { buildSvgProgressBar, renderedFillPercent } from "./svg";

describe("renderedFillPercent", () => {
  it("renders a fully empty bar when the rounded percent is 0", () => {
    expect(renderedFillPercent(0)).toBe(0);
    expect(renderedFillPercent(0.4)).toBe(0);
  });

  it("renders the raw clamped value once the rounded percent is at least 1", () => {
    expect(renderedFillPercent(0.5)).toBe(0.5);
    expect(renderedFillPercent(99.4)).toBe(99.4);
  });

  it("renders a fully full bar when the rounded percent is 100", () => {
    expect(renderedFillPercent(99.5)).toBe(100);
    expect(renderedFillPercent(100)).toBe(100);
  });

  it("clamps out-of-range values before applying the rounding rule", () => {
    expect(renderedFillPercent(-10)).toBe(0);
    expect(renderedFillPercent(150)).toBe(100);
  });
});

describe("buildSvgProgressBar", () => {
  const bar = {
    percent: 80,
    x: 0,
    y: 10,
    width: 100,
    height: 8,
    radius: 4,
    trackFill: "#000000",
    trackFillOpacity: 0.05,
    fill: "#22B8CF",
  };

  it("draws track and fill as rects when there is no pace marker", () => {
    const svg = buildSvgProgressBar(bar);

    expect(svg).toContain('width="100" height="8"');
    expect(svg).toContain('width="80" height="8"');
  });

  it("punches a transparent gap through the bar around the pace marker", () => {
    const svg = buildSvgProgressBar({
      ...bar,
      marker: {
        percent: 50,
        width: 3,
        height: 12,
        radius: 1.5,
        edgeInset: 1,
        fill: "#34C759",
        punchGutter: 2,
      },
    });

    expect(svg).not.toContain('fill-rule="evenodd"');
    expect(svg).toContain("H46.5V18H4");
    expect(svg).toContain("M53.5 10");
    expect(svg).toContain('width="3" height="12" rx="1.5" fill="#34C759"');
  });
});
