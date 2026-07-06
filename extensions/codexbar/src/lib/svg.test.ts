import { describe, expect, it } from "vitest";
import { renderedFillPercent } from "./svg";

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
