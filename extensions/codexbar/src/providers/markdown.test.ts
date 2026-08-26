import { describe, expect, it } from "vitest";
import {
  extractSvgMarkup,
  lineYAfterText,
  markerFills,
  parseDetailSvg,
  parseSvg,
  rectsWithSize,
  textY,
} from "../../test/svg-markdown";
import {
  DETAIL_PANEL,
  DETAIL_SECTION_LAYOUT,
  DETAIL_SVG_LAYOUT,
  DETAIL_TEXT_LAYOUT,
  DETAIL_TYPOGRAPHY,
  getPanelHeight,
  getTextBaselineY,
  getTextBottomY,
} from "../lib/detailMarkdown";
import { buildProviderDetailMarkdown, buildProviderLoadingMarkdown } from "./markdown";

function getTextTopY(baselineY: number, fontSize: number): number {
  return baselineY - Math.ceil(fontSize * DETAIL_TEXT_LAYOUT.topInsetRatio);
}

describe("provider markdown", () => {
  it("renders codex usage and generic sections with semantic content", () => {
    const now = Date.parse("2026-03-23T10:30:00Z");
    const markdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        updatedAt: "2026-03-23T09:00:00Z",
        accountEmail: "dev@example.com",
        planText: "Pro",
        sections: [
          {
            kind: "usage",
            title: "Primary",
            displayTitle: "Session",
            remainingPercent: 53,
            resetsIn: "1h 30m",
          },
          {
            kind: "usage",
            title: "Secondary",
            displayTitle: "Weekly",
            remainingPercent: 88,
            resetsIn: "7d",
          },
          {
            kind: "supplementalUsage",
            title: "Code review",
            remainingPercent: 78,
          },
        ],
      },
      "light",
      { now },
    );

    const [svg] = extractSvgMarkup(markdown);
    const expectedUpdated = "1h ago";

    expect(markdown).toContain("data:image/svg+xml;base64,");
    expect(markdown).not.toContain("prefers-color-scheme");
    expect(markdown).not.toContain("## Primary");
    expect(markdown).not.toContain("- **Remaining:**");
    expect(svg).toContain("<title>Codex detail</title>");
    expect(svg).toContain(">Codex<");
    expect(svg).toContain(">dev@example.com<");
    expect(svg).toContain(">Pro<");
    expect(svg).toContain(`>Updated ${expectedUpdated}<`);
    expect(svg).toContain(">Session<");
    expect(svg).toContain(">Weekly<");
    expect(svg).toContain(">53% left<");
    expect(svg).toContain(">Resets in 1h 30m<");
    expect(svg).toContain(">Code review<");
    expect(svg).toContain(">78% left<");
    expect(svg).not.toContain(">Credits<");
    expect(svg).not.toContain(">General<");
  });

  it("bakes explicit theme colors into svg cards", () => {
    const lightMarkdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        sections: [
          {
            kind: "usage",
            title: "Primary",
            displayTitle: "Session",
            remainingPercent: 53,
            resetsIn: "1h 30m",
          },
        ],
      },
      "light",
    );
    const darkMarkdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        sections: [
          {
            kind: "usage",
            title: "Primary",
            displayTitle: "Session",
            remainingPercent: 53,
            resetsIn: "1h 30m",
          },
        ],
      },
      "dark",
    );

    const [lightSvg] = extractSvgMarkup(lightMarkdown);
    const [darkSvg] = extractSvgMarkup(darkMarkdown);

    expect(lightMarkdown).not.toContain("prefers-color-scheme");
    expect(darkMarkdown).not.toContain("prefers-color-scheme");
    expect(lightSvg).toContain('fill="#111827"');
    expect(lightSvg).toContain('stroke="#E5E7EB"');
    expect(lightSvg).toContain('fill="#000000"');
    expect(lightSvg).toContain('fill-opacity="0.057"');
    expect(lightSvg).toContain('fill="#49A3B0"');
    expect(darkSvg).toContain('fill="#F3F4F6"');
    expect(darkSvg).toContain('stroke="#374151"');
    expect(darkSvg).toContain('fill="#FFFFFF"');
    expect(darkSvg).toContain('fill-opacity="0.054"');
    expect(darkSvg).toContain('fill="#6DB5C0"');
    expect(lightSvg).toContain(">Session<");
    expect(darkSvg).toContain(">Session<");
    expect(lightMarkdown).not.toBe(darkMarkdown);
  });

  it("uses explicit display titles for usage sections", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "claude",
        name: "Claude",
        sections: [
          {
            kind: "usage",
            title: "Primary",
            displayTitle: "Session",
            remainingPercent: 80,
            resetsIn: "30m",
          },
        ],
      },
      "dark",
    );

    const [svg] = extractSvgMarkup(markdown);

    expect(svg).toContain(">Claude<");
    expect(svg).toContain(">Session<");
    expect(svg).not.toContain(">Primary<");
  });

  it("renders supplemental usage sections", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "claude",
        name: "Claude",
        sections: [
          {
            kind: "supplementalUsage",
            title: "Sonnet",
            remainingPercent: 80,
            resetsIn: "30m",
          },
        ],
      },
      "dark",
    );

    const [svg] = extractSvgMarkup(markdown);

    expect(svg).toContain(">Sonnet<");
    expect(svg).toContain(">80% left<");
    expect(svg).toContain(">Resets in 30m<");
  });

  it("renders usage pacing as a second footer row on metric sections", () => {
    const detail = {
      id: "codex",
      name: "Codex",
      sections: [
        {
          kind: "usage" as const,
          title: "Secondary" as const,
          displayTitle: "Weekly",
          remainingPercent: 47,
          resetsIn: "11h 47m",
          usagePacing: {
            stage: "farUnder" as const,
            usedVsIdealDeltaPercent: -39.98,
            idealUsedPercentByNow: 92.98,
            actualUsedPercent: 53,
            lastsUntilReset: true,
            computedAt: "2026-04-16T12:30:00.000Z",
          },
        },
      ],
    };
    const markdown = buildProviderDetailMarkdown(detail, "light");
    const [svg] = extractSvgMarkup(markdown);
    const parsed = parseSvg(svg);
    const darkParsed = parseDetailSvg(buildProviderDetailMarkdown(detail, "dark"));

    expect(svg).toContain(">47% left<");
    expect(svg).toContain(">Resets in 11h 47m<");
    expect(svg).toContain(">40% in reserve<");
    expect(svg).toContain(">Lasts until reset<");
    expect(textY(parsed, "40% in reserve")).toBeGreaterThan(textY(parsed, "47% left"));
    expect(textY(parsed, "Lasts until reset")).toBeGreaterThan(textY(parsed, "Resets in 11h 47m"));
    expect(rectsWithSize(parsed, 3, 12)).toHaveLength(1);
    expect(rectsWithSize(parsed, 3, 12)[0].x).toBeGreaterThan(28);
    expect(rectsWithSize(parsed, 3, 12)[0].x).toBeLessThan(31);
    expect(markerFills(parsed)).toEqual(["#34C759"]);
    expect(markerFills(darkParsed)).toEqual(["#30D158"]);
  });

  it("does not render a usage pacing marker when usage pacing is on track", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        sections: [
          {
            kind: "usage",
            title: "Secondary",
            displayTitle: "Weekly",
            remainingPercent: 47,
            resetsIn: "11h 47m",
            usagePacing: {
              stage: "onTrack",
              usedVsIdealDeltaPercent: 1.2,
              idealUsedPercentByNow: 53,
              actualUsedPercent: 54.2,
              lastsUntilReset: true,
              computedAt: "2026-04-16T12:30:00.000Z",
            },
          },
        ],
      },
      "light",
    );

    const [svg] = extractSvgMarkup(markdown);
    const parsed = parseSvg(svg);

    expect(svg).toContain(">On pace<");
    expect(rectsWithSize(parsed, 3, 12)).toEqual([]);
  });

  it("renders a deficit usage pacing marker in the app's system red", () => {
    const detail = {
      id: "codex",
      name: "Codex",
      sections: [
        {
          kind: "usage" as const,
          title: "Secondary" as const,
          displayTitle: "Weekly",
          remainingPercent: 10,
          resetsIn: "2d",
          usagePacing: {
            stage: "farOver" as const,
            usedVsIdealDeltaPercent: 23.4,
            idealUsedPercentByNow: 66.6,
            actualUsedPercent: 90,
            lastsUntilReset: false,
            computedAt: "2026-04-16T12:30:00.000Z",
          },
        },
      ],
    };
    const lightParsed = parseDetailSvg(buildProviderDetailMarkdown(detail, "light"));
    const darkParsed = parseDetailSvg(buildProviderDetailMarkdown(detail, "dark"));

    expect(markerFills(lightParsed)).toEqual(["#FF383C"]);
    expect(markerFills(darkParsed)).toEqual(["#FF4245"]);
  });

  it("does not render a usage pacing marker when usage pacing is absent", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        sections: [
          {
            kind: "usage",
            title: "Secondary",
            displayTitle: "Weekly",
            remainingPercent: 47,
            resetsIn: "11h 47m",
          },
        ],
      },
      "light",
    );

    const parsed = parseDetailSvg(markdown);

    expect(rectsWithSize(parsed, 3, 12)).toEqual([]);
  });

  it("supports overriding header subtitle while keeping sections", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        updatedAt: "2026-03-23T09:00:00Z",
        accountEmail: "dev@example.com",
        planText: "Pro",
        sections: [
          {
            kind: "usage",
            title: "Primary",
            displayTitle: "Session",
            remainingPercent: 53,
            resetsIn: "1h 30m",
          },
        ],
      },
      "light",
      { subtitle: "Updating..." },
    );

    const [svg] = extractSvgMarkup(markdown);

    expect(svg).toContain(">Codex<");
    expect(svg).toContain(">dev@example.com<");
    expect(svg).toContain(">Pro<");
    expect(svg).toContain(">Updating...<");
    expect(svg).not.toContain(">Updated ");
    expect(svg).toContain(">Session<");
  });

  it("renders compact relative header timestamps within six hours", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        updatedAt: "2026-03-23T10:03:00Z",
        sections: [],
      },
      "light",
      { now: Date.parse("2026-03-23T10:30:00Z") },
    );

    const [svg] = extractSvgMarkup(markdown);

    expect(svg).toContain(">Updated 27m ago<");
  });

  it("uses just now for fresh or future-skewed header timestamps", () => {
    const freshMarkdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        updatedAt: "2026-03-23T10:29:45Z",
        sections: [],
      },
      "light",
      { now: Date.parse("2026-03-23T10:30:00Z") },
    );
    const futureMarkdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        updatedAt: "2026-03-23T10:35:00Z",
        sections: [],
      },
      "light",
      { now: Date.parse("2026-03-23T10:30:00Z") },
    );

    const [freshSvg] = extractSvgMarkup(freshMarkdown);
    const [futureSvg] = extractSvgMarkup(futureMarkdown);

    expect(freshSvg).toContain(">Updated just now<");
    expect(futureSvg).toContain(">Updated just now<");
  });

  it("keeps older header timestamps relative without an absolute cutoff", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        updatedAt: "2026-03-23T10:00:00Z",
        sections: [],
      },
      "light",
      { now: Date.parse("2026-03-23T16:00:01Z") },
    );

    const [svg] = extractSvgMarkup(markdown);

    expect(svg).toContain(">Updated 6h ago<");
  });

  it("renders header-only cards when only account metadata exists", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "vertexai",
        name: "Vertex AI",
        accountEmail: "dev@example.com",
        planText: "Gcloud",
        sections: [],
      },
      "light",
    );

    const [svg] = extractSvgMarkup(markdown);

    expect(markdown).toContain("data:image/svg+xml;base64,");
    expect(svg).toContain(">Vertex AI<");
    expect(svg).toContain(">dev@example.com<");
    expect(svg).toContain(">Gcloud<");
    expect(svg).not.toContain("<line ");
  });

  it("renders header-only loading markdown", () => {
    const markdown = buildProviderLoadingMarkdown(
      {
        name: "Codex",
      },
      "dark",
    );

    const [svg] = extractSvgMarkup(markdown);

    expect(svg).toContain("<title>Codex detail</title>");
    expect(svg).toContain(">Codex<");
    expect(svg).toContain(">Updating...<");
    expect(svg).not.toContain(">Session<");
    expect(svg).toContain("<line ");
    expect(svg).not.toContain('fill="#6DB5C0"');
    const parsed = parseSvg(svg);
    expect(rectsWithSize(parsed, 88, 10)).toHaveLength(2);
    expect(rectsWithSize(parsed, 440, 8)).toHaveLength(2);
    expect(rectsWithSize(parsed, 76, 8)).toHaveLength(2);
    expect(rectsWithSize(parsed, 92, 8)).toHaveLength(2);

    const progressTrackYs = rectsWithSize(parsed, 440, 8).map((rect) => rect.y);
    expect(progressTrackYs[1]).toBeGreaterThan(progressTrackYs[0]);
    expect(progressTrackYs[1] - progressTrackYs[0]).toBe(75);
  });

  it("falls back to plain text for empty details", () => {
    expect(
      buildProviderDetailMarkdown({
        id: "warp",
        name: "Warp",
        sections: [],
      }),
    ).toBe("No data available");
  });

  it("sizes the generated usage image to the content with no extra vertical canvas padding", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        sections: [
          {
            kind: "usage",
            title: "Primary",
            displayTitle: "Session",
            remainingPercent: 53,
            resetsIn: "1h 30m",
          },
        ],
      },
      "light",
    );

    const [svg] = extractSvgMarkup(markdown);
    const parsed = parseSvg(svg);
    const lastFooterY = textY(parsed, "53% left");
    const expectedHeight = getPanelHeight(getTextBottomY(lastFooterY, DETAIL_TYPOGRAPHY.rowValueSize));
    const viewBoxMatch = svg.match(new RegExp(`viewBox="0 0 ${DETAIL_PANEL.width} (\\d+(?:\\.\\d+)?)"`));

    expect(textY(parsed, "Codex")).toBe(getTextBaselineY(DETAIL_PANEL.paddingTop, DETAIL_TYPOGRAPHY.headerTitleSize));
    expect(viewBoxMatch?.[1]).toBe(String(expectedHeight));
    expect(markdown).toContain(`raycast-width=${DETAIL_PANEL.width}`);
    expect(markdown).toContain(`raycast-height=${expectedHeight}`);
  });

  it("places the next divider below the rendered footer text, not its baseline", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        sections: [
          {
            kind: "usage",
            title: "Primary",
            displayTitle: "Session",
            remainingPercent: 53,
            resetsIn: "1h 30m",
          },
          {
            kind: "usage",
            title: "Secondary",
            displayTitle: "Weekly",
            remainingPercent: 88,
            resetsIn: "7d",
          },
          {
            kind: "info",
            title: "OpenRouter",
            items: [{ label: "Balance", value: "$25.50" }],
          },
        ],
      },
      "dark",
    );

    const [svg] = extractSvgMarkup(markdown);
    const parsed = parseSvg(svg);
    const weeklyFooterY = textY(parsed, "Resets in 7d");
    const infoTitleY = textY(parsed, "OpenRouter");
    const infoDividerY = lineYAfterText(parsed, "Resets in 7d");

    const expectedHalfGap = DETAIL_SECTION_LAYOUT.dividerPaddingY + DETAIL_SVG_LAYOUT.dividerStrokeWidth / 2;
    const gapAboveDivider = infoDividerY - getTextBottomY(weeklyFooterY, DETAIL_TYPOGRAPHY.rowValueSize);
    const gapBelowDivider = getTextTopY(infoTitleY, DETAIL_TYPOGRAPHY.sectionTitleSize) - infoDividerY;

    expect(gapAboveDivider).toBeCloseTo(expectedHalfGap);
    expect(gapBelowDivider).toBeCloseTo(expectedHalfGap);
  });

  it("renders incident status as a subtle footer below the usage sections", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        sections: [{ kind: "usage", title: "Primary", displayTitle: "Session", remainingPercent: 61 }],
      },
      "light",
      {
        status: {
          indicator: "minor",
          description: "Partial System Degradation",
          updatedAt: "2026-07-08T09:00:00Z",
        },
      },
    );

    const [svg] = extractSvgMarkup(markdown);
    expect(svg).toContain("Session</text>");
    expect(svg).toMatch(/Partial System Degradation - Updated .*2026.*<\/text>/);
    expect(svg).not.toContain("Partial outage</text>");
    expect(svg.indexOf("Partial System Degradation - Updated")).toBeGreaterThan(svg.indexOf("Session</text>"));
    expect(svg).toContain('fill="#F59E0B" fill-rule="evenodd"');
  });

  it("renders a header and status footer when only a renderable status exists", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        sections: [],
      },
      "light",
      { status: { indicator: "major", description: "Major Service Outage" } },
    );

    const [svg] = extractSvgMarkup(markdown);
    expect(markdown).not.toBe("No data available");
    expect(svg).toContain(">Codex<");
    expect(svg).toContain("Major Service Outage</text>");
  });

  it("renders the status label when the incident has no description", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        sections: [{ kind: "usage", title: "Primary", displayTitle: "Session", remainingPercent: 61 }],
      },
      "light",
      { status: { indicator: "maintenance" } },
    );

    const [svg] = extractSvgMarkup(markdown);
    expect(svg).toContain("Session</text>");
    expect(svg).toContain("Maintenance</text>");
  });

  it("omits status text for operational status", () => {
    const markdown = buildProviderDetailMarkdown(
      {
        id: "codex",
        name: "Codex",
        sections: [{ kind: "usage", title: "Primary", displayTitle: "Session", remainingPercent: 61 }],
      },
      "light",
      { status: { indicator: "none", description: "All systems operational" } },
    );

    const [svg] = extractSvgMarkup(markdown);
    expect(svg).not.toContain("Operational</text>");
    expect(svg).not.toContain("All systems operational");
  });
});
