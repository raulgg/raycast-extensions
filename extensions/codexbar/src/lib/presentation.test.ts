import { describe, expect, it } from "vitest";
import { DETAIL_TYPOGRAPHY } from "./detailMarkdown";
import {
  buildProviderErrorMarkdown,
  formatLocalDateTime,
  formatPercentRemaining,
  formatRelativeUpdateTime,
  getRelativeUpdateTimeRefreshDelay,
} from "./presentation";
import { extractSvgMarkup } from "../../test/svg-markdown";

describe("presentation helpers", () => {
  it("formats remaining percent like upstream UsageFormatter.percentString", () => {
    expect(formatPercentRemaining(0)).toBe("0%");
    expect(formatPercentRemaining(0.1)).toBe("<1%");
    expect(formatPercentRemaining(0.4)).toBe("<1%");
    expect(formatPercentRemaining(0.6)).toBe("<1%");
    expect(formatPercentRemaining(0.96)).toBe("<1%");
    expect(formatPercentRemaining(1)).toBe("1%");
    expect(formatPercentRemaining(99.4)).toBe("99%");
    expect(formatPercentRemaining(-1)).toBe("0%");
    expect(formatPercentRemaining(101)).toBe("100%");
  });

  it("formats timestamps as compact local datetimes", () => {
    expect(formatLocalDateTime("2026-04-05T15:11:00.000Z", "en-US", "UTC")).toBe("Apr 5, 2026, 3:11 PM");
  });

  it("returns the raw timestamp when parsing fails", () => {
    expect(formatLocalDateTime("not-a-date")).toBe("not-a-date");
  });

  it("formats relative update timestamps with compact units", () => {
    const now = Date.parse("2026-04-05T15:11:00.000Z");

    expect(formatRelativeUpdateTime("2026-04-05T15:10:45.000Z", { now })).toBe("just now");
    expect(formatRelativeUpdateTime("2026-04-05T14:44:00.000Z", { now })).toBe("27m ago");
    expect(formatRelativeUpdateTime("2026-04-05T13:11:00.000Z", { now })).toBe("2h ago");
  });

  it("computes the next relative timestamp refresh boundary", () => {
    expect(getRelativeUpdateTimeRefreshDelay("2026-04-05T15:10:45.000Z", Date.parse("2026-04-05T15:11:00.000Z"))).toBe(
      45_000,
    );
    expect(getRelativeUpdateTimeRefreshDelay("2026-04-05T14:43:45.000Z", Date.parse("2026-04-05T15:11:00.000Z"))).toBe(
      45_000,
    );
    expect(getRelativeUpdateTimeRefreshDelay("2026-04-05T13:40:45.000Z", Date.parse("2026-04-05T15:11:00.000Z"))).toBe(
      1_785_000,
    );
  });

  it("builds markdown blocks for errors", () => {
    const markdown = buildProviderErrorMarkdown("Load failed", new Error("boom"));
    const [svg] = extractSvgMarkup(markdown);

    expect(markdown).toContain("data:image/svg+xml;base64,");
    expect(svg).toContain(">Load failed<");
    expect(svg).toContain(">boom<");
    expect(svg).toContain(`font-size="${DETAIL_TYPOGRAPHY.headerTitleSize}"`);
    expect(svg).toContain('fill="#111827"');
    expect(svg).toContain('stroke="#E5E7EB"');
    expect(svg).toContain('fill="#FF6B6B"');
  });

  it("builds dark markdown blocks for errors", () => {
    const markdown = buildProviderErrorMarkdown("Load failed", new Error("boom"), "dark");
    const [svg] = extractSvgMarkup(markdown);

    expect(svg).toContain('fill="#F3F4F6"');
    expect(svg).toContain('stroke="#374151"');
    expect(svg).toContain('fill="#FF6B6B"');
  });

  it("escapes html in error messages", () => {
    const [svg] = extractSvgMarkup(buildProviderErrorMarkdown("Load failed", new Error('<boom> & "bad"')));

    expect(svg).toContain("&lt;boom&gt; &amp; &quot;bad&quot;");
  });

  it("preserves paragraph breaks in error messages", () => {
    const [svg] = extractSvgMarkup(
      buildProviderErrorMarkdown("Load failed", new Error("Original error.\n\nWhat happened.\n\nWhat to do next.")),
    );
    const originalY = getTextY(svg, "Original error.");
    const explanationY = getTextY(svg, "What happened.");
    const recoveryY = getTextY(svg, "What to do next.");

    expect(explanationY - originalY).toBeGreaterThan(24);
    expect(recoveryY - explanationY).toBeGreaterThan(24);
  });
});

function getTextY(svg: string, text: string): number {
  const match = svg.match(new RegExp(`<text[^>]* y="(\\d+)"[^>]*>${text}</text>`));
  expect(match).toBeTruthy();
  return Number(match?.[1]);
}
